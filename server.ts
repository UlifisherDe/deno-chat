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

// 中间件配置
app.use(oakCors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(async (ctx, next) => {
  console.log(`[${new Date().toISOString()}] ${ctx.request.method} ${ctx.request.url.pathname}`);
  try {
    await next();
  } catch (err) {
    ctx.response.status = 500;
    ctx.response.body = { error: "SERVER_ERROR" };
    console.error("Error:", err);
  }
});

// 用户注册
router.post("/register", async (ctx) => {
  try {
    const body = await ctx.request.body().value;
    const { username, password } = body;

    // 输入验证
    if (!username?.trim() || !password?.trim()) {
      ctx.response.status = 400;
      ctx.response.body = { error: "INVALID_INPUT" };
      return;
    }

    // 检查用户是否存在
    const existingUser = await kv.get(["users", username]);
    if (existingUser.value) {
      ctx.response.status = 409;
      ctx.response.body = { error: "USER_EXISTS" };
      return;
    }

    // 生成安全凭证
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(password + toHashString(salt))
    );

    // 存储用户数据
    await kv.set(["users", username], {
      username,
      passwordHash: toHashString(new Uint8Array(hashBuffer)),
      salt: toHashString(salt)
    });

    ctx.response.body = { success: true };
    console.log(`[注册成功] 用户名: ${username}`);

  } catch (error) {
    console.error("[注册失败]", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "REGISTRATION_FAILED" };
  }
});

// 用户登录
router.post("/login", async (ctx) => {
  try {
    const body = await ctx.request.body().value;
    const { username, password } = body;

    // 获取用户数据
    const userEntry = await kv.get<User>(["users", username]);
    if (!userEntry.value) {
      ctx.response.status = 404;
      ctx.response.body = { error: "USER_NOT_FOUND" };
      return;
    }

    // 验证密码
    const salt = Uint8Array.from(atob(userEntry.value.salt), c => c.charCodeAt(0));
    const storedHash = Uint8Array.from(atob(userEntry.value.passwordHash), c => c.charCodeAt(0));
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(password + toHashString(salt))
    );

    if (!arraysEqual(new Uint8Array(hashBuffer), storedHash)) {
      ctx.response.status = 401;
      ctx.response.body = { error: "INVALID_CREDENTIALS" };
      return;
    }

    // 生成访问令牌
    const token = btoa(JSON.stringify({
      username,
      exp: Date.now() + 86400_000 // 24小时有效期
    }));

    ctx.response.body = { token };
    console.log(`[登录成功] 用户名: ${username}`);

  } catch (error) {
    console.error("[登录失败]", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "LOGIN_FAILED" };
  }
});

// 消息存储与实时通信
router.get("/ws", async (ctx) => {
  const socket = await ctx.upgrade();
  const token = ctx.request.url.searchParams.get("token");

  try {
    // 验证令牌
    const { username, exp } = JSON.parse(atob(token || ""));
    if (Date.now() > exp) throw new Error("TOKEN_EXPIRED");
    
    const user = await kv.get(["users", username]);
    if (!user.value) throw new Error("INVALID_USER");

    // 发送历史消息
    const messages = await getMessages(20);
    socket.send(JSON.stringify({ type: "history", data: messages }));

    // 实时消息处理
    socket.onmessage = async (event) => {
      try {
        const message: Message = {
          encryptedText: event.data,
          iv: toHashString(crypto.getRandomValues(new Uint8Array(12))),
          timestamp: new Date().toISOString(),
          user: username
        };

        await kv.set(["messages", Date.now()], message);
        broadcastMessage(message);
      } catch (error) {
        console.error("[消息处理失败]", error);
      }
    };

  } catch (error) {
    console.error("[WS认证失败]", error);
    socket.close(1008, "AUTH_FAILED");
  }
});

// 辅助函数
async function getMessages(limit: number): Promise<Message[]> {
  const entries = kv.list<Message>({ prefix: ["messages"] }, { 
    reverse: true,
    limit 
  });

  const messages: Message[] = [];
  for await (const entry of entries) messages.push(entry.value);
  return messages;
}

function broadcastMessage(message: Message) {
  app.context.wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "message", data: message }));
    }
  });
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((val, idx) => val === b[idx]);
}

// 静态文件服务
app.use(router.routes());
app.use(router.allowedMethods());
app.use(async (ctx) => {
  await ctx.send({
    root: `${Deno.cwd()}/static`,
    index: "index.html"
  });
});

// 启动服务器
console.log("🚀 Server running on http://localhost:8000");
await app.listen({ port: 8000 });
