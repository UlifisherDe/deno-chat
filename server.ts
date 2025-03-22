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
    ctx.response.body = { error: "Internal Server Error" };
  }
});

// 用户注册
router.post("/register", async (ctx) => {
  const { username, password } = await ctx.request.body().value;
  
  if (await kv.get(["users", username])) {
    ctx.response.status = 400;
    ctx.response.body = { error: "用户名已存在" };
    return;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await deriveHash(password, salt);
  
  await kv.set(["users", username], {
    username,
    passwordHash: toHashString(passwordHash),
    salt: toHashString(salt)
  });

  ctx.response.body = { success: true };
});

// 用户登录
router.post("/login", async (ctx) => {
  const { username, password } = await ctx.request.body().value;
  const user = await kv.get<User>(["users", username]);

  if (!user.value || !verifyPassword(password, user.value)) {
    ctx.response.status = 401;
    ctx.response.body = { error: "认证失败" };
    return;
  }

  const token = btoa(JSON.stringify({ 
    username,
    exp: Date.now() + 86400_000 // 24小时过期
  }));

  ctx.response.body = { token };
});

// 消息历史
router.get("/messages", async (ctx) => {
  const page = parseInt(ctx.request.url.searchParams.get("page") || "1");
  const limit = 20;
  
  const entries = kv.list<Message>({ prefix: ["messages"] }, {
    reverse: true,
    limit: page * limit
  });

  const messages: Message[] = [];
  for await (const entry of entries) messages.push(entry.value);

  ctx.response.body = messages.slice(-limit).reverse();
});

// WebSocket实时通信
router.get("/ws", async (ctx) => {
  const socket = await ctx.upgrade();
  const token = ctx.request.url.searchParams.get("token");

  try {
    const { username } = JSON.parse(atob(token || ""));
    if (!(await kv.get(["users", username])).value) throw new Error();
    
    // 发送初始历史
    const history = await getRecentMessages();
    socket.send(JSON.stringify({ type: "history", data: history }));

    // 消息处理
    socket.onmessage = async (event) => {
      const message = await processMessage(event.data, username);
      broadcastMessage(message);
      await kv.set(["messages", Date.now()], message);
    };

  } catch {
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

// 启动
console.log("Server running on http://localhost:8000");
await app.listen({ port: 8000 });

// 工具函数
async function deriveHash(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw", 
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
}

function verifyPassword(password: string, user: User) {
  const salt = new Uint8Array(
    atob(user.salt).split("").map(c => c.charCodeAt(0))
  );
  const storedHash = new Uint8Array(
    atob(user.passwordHash).split("").map(c => c.charCodeAt(0))
  );
  const newHash = await deriveHash(password, salt);
  return arraysEqual(new Uint8Array(newHash), storedHash);
}

async function processMessage(data: string, username: string): Promise<Message> {
  return {
    encryptedText: data,
    iv: crypto.getRandomValues(new Uint8Array(12)).toString(),
    timestamp: new Date().toISOString(),
    user: username
  };
}

function broadcastMessage(message: Message) {
  app.context.wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "message", data: message }));
    }
  });
}

async function getRecentMessages(limit = 20) {
  const entries = kv.list<Message>({ prefix: ["messages"] }, { reverse: true, limit });
  const messages: Message[] = [];
  for await (const entry of entries) messages.push(entry.value);
  return messages;
}

function arraysEqual(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((val, i) => val === b[i]);
}
