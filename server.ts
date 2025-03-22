import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { crypto } from "https://deno.land/std@0.207.0/crypto/mod.ts";

// 类型定义
interface User {
  username: string;
  passwordHash: Uint8Array;
  salt: Uint8Array;
}

interface Message {
  encryptedText: string;
  iv: string;
  timestamp: string;
  user: string;
}

const kv = await Deno.openKv();
const app = new Application();
const router = new Router();

// 中间件：解析JSON请求体
app.use(async (ctx, next) => {
  if (ctx.request.hasBody) {
    const body = ctx.request.body();
    if (body.type === "json") {
      ctx.state.body = await body.value;
    }
  }
  await next();
});

// 用户注册
router.post("/register", async (ctx) => {
  const { username, password } = ctx.state.body;
  if (!username || !password) {
    ctx.response.status = 400;
    ctx.response.body = { error: "用户名和密码不能为空" };
    return;
  }

  const existingUser = await kv.get(["users", username]);
  if (existingUser.value) {
    ctx.response.status = 400;
    ctx.response.body = { error: "用户名已存在" };
    return;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const passwordHash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );

  await kv.set(["users", username], {
    username,
    passwordHash: new Uint8Array(passwordHash),
    salt,
  });

  ctx.response.body = { success: true };
});

// 用户登录
router.post("/login", async (ctx) => {
  const { username, password } = ctx.state.body;
  const userEntry = await kv.get<User>(["users", username]);
  if (!userEntry.value) {
    ctx.response.status = 401;
    ctx.response.body = { error: "用户不存在" };
    return;
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedHash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: userEntry.value.salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );

  if (!equalArrays(new Uint8Array(derivedHash), userEntry.value.passwordHash)) {
    ctx.response.status = 401;
    ctx.response.body = { error: "密码错误" };
    return;
  }

  const token = btoa(JSON.stringify({ username, exp: Date.now() + 3600_000 }));
  ctx.response.body = { token };
});

// 分页获取历史消息
router.get("/history", async (ctx) => {
  const page = parseInt(ctx.request.url.searchParams.get("page") || "1");
  const limit = 10;
  const entries = kv.list<Message>({ prefix: ["messages"] }, { reverse: true, limit: page * limit });
  const messages: Message[] = [];
  for await (const entry of entries) messages.push(entry.value);
  ctx.response.body = messages.slice((page - 1) * limit, page * limit);
});

// WebSocket实时通信
router.get("/ws", async (ctx) => {
  const socket = await ctx.upgrade();
  const token = ctx.request.url.searchParams.get("token");
  
  try {
    const { username } = JSON.parse(atob(token || ""));
    const user = await kv.get(["users", username]);
    if (!user.value) throw new Error("无效用户");

    // 发送前10条历史消息
    const history = kv.list<Message>({ prefix: ["messages"] }, { reverse: true, limit: 10 });
    const messages: Message[] = [];
    for await (const entry of history) messages.push(entry.value);
    socket.send(JSON.stringify({ type: "history", data: messages }));

    // 处理新消息
    socket.onmessage = async (event) => {
      try {
        const { encryptedText, iv } = JSON.parse(event.data);
        const message: Message = {
          encryptedText,
          iv,
          timestamp: new Date().toISOString(),
          user: username,
        };
        await kv.set(["messages", Date.now()], message);
        
        // 广播消息
        const broadcastMsg = JSON.stringify({ type: "message", data: message });
        ctx.app.wsServer.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
        });
      } catch (error) {
        console.error("消息处理失败:", error);
      }
    };
  } catch (error) {
    socket.close(1008, "认证失败");
  }
});

// 静态文件服务
app.use(async (ctx) => {
  const __dirname = new URL(".", import.meta.url).pathname;
  await ctx.send({
    root: `${__dirname}/static`,
    index: "index.html",
  });
});

// 启动服务器
console.log("Server running on http://localhost:8000");
await app.listen({ port: 8000 });

// 工具函数：比较Uint8Array
function equalArrays(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
