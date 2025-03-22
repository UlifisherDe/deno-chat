import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { crypto, toHashString } from "https://deno.land/std@0.207.0/crypto/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

// 调试模式开关
const DEBUG = true;

interface User {
  username: string;
  passwordHash: string;
  salt: string;
}

const kv = await Deno.openKv();
const app = new Application();
const router = new Router();

// ========== [1] 中间件配置 ==========
app.use(oakCors({ origin: "*" }));
app.use(async (ctx, next) => {
  if (ctx.request.hasBody) {
    try {
      ctx.state.body = await ctx.request.body().value;
      DEBUG && console.log("请求体:", ctx.state.body);
    } catch (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: "无效的JSON格式" };
      return;
    }
  }
  await next();
});

// ========== [2] 用户注册 ==========
router.post("/register", async (ctx) => {
  const { username, password } = ctx.state.body || {};
  
  // 输入验证
  if (!username?.trim() || !password?.trim()) {
    ctx.response.status = 400;
    ctx.response.body = { error: "用户名和密码不能为空" };
    return;
  }

  try {
    // 检查用户是否存在
    const existingUser = await kv.get<User>(["users", username]);
    if (existingUser.value) {
      ctx.response.status = 409;
      ctx.response.body = { error: "用户名已被注册" };
      return;
    }

    // 生成密码哈希
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(password + toHashString(salt))
    );

    // 存储用户数据
    await kv.set(["users", username], {
      username,
      passwordHash: toHashString(new Uint8Array(hashBuffer)),
      salt: toHashString(salt)
    });

    ctx.response.body = { success: true };
    DEBUG && console.log(`[注册成功] 用户: ${username}`);

  } catch (error) {
    console.error("注册错误:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "注册失败" };
  }
});

// ========== [3] 用户登录 ==========
router.post("/login", async (ctx) => {
  const { username, password } = ctx.state.body || {};

  try {
    // 获取用户数据
    const user = await kv.get<User>(["users", username]);
    DEBUG && console.log("数据库查询结果:", user);

    if (!user.value) {
      ctx.response.status = 404;
      ctx.response.body = { error: "用户不存在" };
      return;
    }

    // 转换存储的盐值
    const salt = Uint8Array.from(atob(user.value.salt), c => c.charCodeAt(0)));
    DEBUG && console.log("盐值对比:", {
      stored: user.value.salt,
      converted: toHashString(salt)
    });

    // 生成新哈希
    const newHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(password + toHashString(salt))
    );
    const newHashStr = toHashString(new Uint8Array(newHash));
    
    DEBUG && console.log("哈希对比:", {
      stored: user.value.passwordHash,
      generated: newHashStr
    });

    // 验证密码
    if (user.value.passwordHash !== newHashStr) {
      ctx.response.status = 401;
      ctx.response.body = { error: "密码错误" };
      return;
    }

    // 生成Token
    const token = btoa(JSON.stringify({
      username,
      exp: Date.now() + 86400_000
    }));
    
    ctx.response.body = { token };
    DEBUG && console.log(`[登录成功] 用户: ${username}`);

  } catch (error) {
    console.error("登录错误:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "登录失败" };
  }
});

// ========== [4] 其他配置 ==========
app.use(router.routes());
app.use(router.allowedMethods());

// 静态文件服务
app.use(async (ctx) => {
  await ctx.send({
    root: `${Deno.cwd()}/static`,
    index: "index.html"
  });
});

console.log("🚀 服务已启动: http://localhost:8000");
await app.listen({ port: 8000 });
