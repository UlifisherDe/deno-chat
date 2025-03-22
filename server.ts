import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { crypto, toHashString } from "https://deno.land/std@0.207.0/crypto/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

// 类型定义
interface User {
  username: string;
  passwordHash: string;
  salt: string;
}

interface Message {
  encryptedText: string;
  iv: string;
  timestamp: string;
  user: string;
}

// 初始化
const kv = await Deno.openKv();
const app = new Application();
const router = new Router();

// 中间件
app.use(oakCors({ origin: "*" }));
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.response.status = 500;
    ctx.response.body = { error: "服务器内部错误" };
  }
});

// 用户注册
router.post("/register", async (ctx) => {
  const { username, password } = await ctx.request.body().value;
  
  // 验证用户名是否已存在
  if (await kv.get(["users", username])) {
    ctx.response.status = 400;
    ctx.response.body = { error: "用户名已存在" };
    return;
  }

  // 生成盐值和密码哈希
  const saltArr = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await deriveHash(password, saltArr);
  
  // 存储用户信息
  await kv.set(["users", username], {
    username,
    passwordHash: toHashString(passwordHash),
    salt: toHashString(saltArr)
  });

  ctx.response.body = { success: true };
});

// 用户登录
router.post("/login", async (ctx) => {
  const { username, password } = await ctx.request.body().value;
  const userEntry = await kv.get<User>(["users", username]);

  // 验证用户是否存在
  if (!userEntry.value) {
    ctx.response.status = 401;
    ctx.response.body = { error: "用户不存在" };
    return;
  }

  // 验证密码
  const isValid = await verifyPassword(password, userEntry.value);
  if (!isValid) {
    ctx.response.status = 401;
    ctx.response.body = { error: "密码错误" };
    return;
  }

  // 生成 Token
  const token = btoa(JSON.stringify({ 
    username,
    exp: Date.now() + 86400_000 // 24小时有效期
  }));

  ctx.response.body = { token };
});

// 获取历史消息（分页）
router.get("/messages", async (ctx) => {
  const page = parseInt(ctx.request.url.searchParams.get("page") || "1");
  const limit = 20;
  
  const entries = kv.list<Message>({ prefix: ["messages"] }, {
    reverse: true,
    limit: page * limit
  });

  const messages: Message[] = [];
  for await (const entry of entries) {
    messages.push(entry.value);
  }

  ctx.response.body = messages.slice(-limit).reverse();
});

// WebSocket 实时通信
router.get("/ws", async (ctx) => {
  const socket = await ctx.upgrade();
  const token = ctx.request.url.searchParams.get("token");

  try {
    // 解析 Token
    const { username } = JSON.parse(atob(token || ""));
    const user = await kv.get(["users", username]);
    
    // 验证用户有效性
    if (!user.value) throw new Error("无效用户");

    // 发送最近消息
    const history = await getRecentMessages();
    socket.send(JSON.stringify({ type: "history", data: history }));

    // 处理新消息
    socket.onmessage = async (event) => {
      const message: Message = {
        encryptedText: event.data,
        iv: toHashString(crypto.getRandomValues(new Uint8Array(12))),
        timestamp: new Date().toISOString(),
        user: username
      };
      
      // 存储并广播消息
      await kv.set(["messages", Date.now()], message);
      broadcastMessage(message);
    };

  } catch (error) {
    socket.close(1008, "认证失败");
  }
});

// 静态文件服务
app.use(async (ctx) => {
  await ctx.send({
    root: `${Deno.cwd()}/static`,
    index: "index.html"
  });
});

// 启动服务器
console.log("Server running on http://localhost:8000");
await app.listen({ port: 8000 });

// 密码哈希生成
async function deriveHash(password: string, salt: Uint8Array) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
}

// 密码验证
async function verifyPassword(password: string, user: User) {
  const salt = Uint8Array.from(atob(user.salt), c => c.charCodeAt(0)));
  const storedHash = Uint8Array.from(atob(user.passwordHash), c => c.charCodeAt(0)));
  const newHash = await deriveHash(password, salt);
  return arraysEqual(new Uint8Array(newHash), storedHash);
}

// 广播消息
function broadcastMessage(message: Message) {
  app.context.wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "message", data: message }));
    }
  });
}

// 获取最近消息
async function getRecentMessages(limit = 20) {
  const entries = kv.list<Message>({ prefix: ["messages"] }, { 
    reverse: true, 
    limit 
  });
  
  const messages: Message[] = [];
  for await (const entry of entries) {
    messages.push(entry.value);
  }
  return messages;
}

// 数组比较
function arraysEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  return a.every((val, index) => val === b[index]);
}
