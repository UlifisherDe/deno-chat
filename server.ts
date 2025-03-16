import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { crypto } from "https://deno.land/std@0.207.0/crypto/mod.ts";

// 类型定义
interface User {
  username: string;
  passwordHash: string; // 加密后的密码
  salt: Uint8Array; // 密码盐值
}

interface Message {
  encryptedText: string; // 加密后的消息 (Base64)
  iv: string; // 加密初始向量 (Base64)
  timestamp: string;
  user: string;
}

// 初始化 Deno KV
const kv = await Deno.openKv();

// 创建 Oak 应用
const app = new Application();
const router = new Router();
app.use(router.routes());
app.use(router.allowedMethods());

// 用户注册
router.post("/register", async (ctx) => {
  const { username, password } = await ctx.request.body().value;
  const existingUser = await kv.get(["users", username]);
  if (existingUser.value) {
    ctx.response.status = 400;
    ctx.response.body = { error: "用户名已存在" };
    return;
  }

  // 生成盐值并加密密码
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

  // 存储用户
  await kv.set(["users", username], {
    username,
    passwordHash: new Uint8Array(passwordHash),
    salt,
  });

  ctx.response.body = { success: true };
});

// 用户登录
router.post("/login", async (ctx) => {
  const { username, password } = await ctx.request.body().value;
  const user = await kv.get<User>(["users", username]);
  if (!user.value) {
    ctx.response.status = 401;
    ctx.response.body = { error: "用户不存在" };
    return;
  }

  // 验证密码
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedHash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: user.value.salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );

  if (Array.from(new Uint8Array(derivedHash)).toString() !== Array.from(user.value.passwordHash).toString()) {
    ctx.response.status = 401;
    ctx.response.body = { error: "密码错误" };
    return;
  }

  // 生成 JWT Token (简化版)
  const token = btoa(JSON.stringify({ username }));
  ctx.response.body = { token };
});

// 获取分页历史消息
router.get("/history", async (ctx) => {
  const page = parseInt(ctx.request.url.searchParams.get("page") || "1");
  const limit = 10;
  const entries = kv.list<Message>({ prefix: ["messages"] }, { reverse: true, limit: page * limit });
  const messages: Message[] = [];
  for await (const entry of entries) {
    messages.push(entry.value);
  }
  // 计算分页
  const start = (page - 1) * limit;
  const end = start + limit;
  ctx.response.body = messages.slice(start, end);
});

// WebSocket 处理 (消息加密存储)
router.get("/ws", async (ctx) => {
  const socket = await ctx.upgrade();
  const token = ctx.request.url.searchParams.get("token");
  if (!token) {
    socket.close(1008, "未授权");
    return;
  }

  // 解析 Token 获取用户
  let username: string;
  try {
    const payload = JSON.parse(atob(token));
    username = payload.username;
  } catch {
    socket.close(1008, "Token无效");
    return;
  }

  // 发送历史消息（第一页）
  const history = await kv.list<Message>({ prefix: ["messages"] }, { reverse: true, limit: 10 });
  const messages: Message[] = [];
  for await (const entry of history) {
    messages.push(entry.value);
  }
  socket.send(JSON.stringify({ type: "history", data: messages }));

  // 监听新消息
  socket.onmessage = async (event) => {
    const { encryptedText, iv } = JSON.parse(event.data);
    const message: Message = {
      encryptedText,
      iv,
      timestamp: new Date().toISOString(),
      user: username,
    };
    await kv.set(["messages", Date.now()], message);
    // 广播加密后的消息
    for (const client of ctx.app.wsServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "message", data: message }));
      }
    }
  };
});

// 静态文件
app.use(async (ctx) => {
  const __dirname = new URL(".", import.meta.url).pathname;
  await ctx.send({ root: `${__dirname}/static`, index: "index.html" });
});

await app.listen({ port: 8000 });
