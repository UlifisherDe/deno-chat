import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { DenoKvChat, Message } from "./types.ts"; // 类型定义（可选）

// 初始化 Deno KV 数据库
const kv = await Deno.openKv();

// 创建 Oak 应用
const app = new Application();
const router = new Router();

// 存储聊天消息到 Deno KV
async function saveMessage(message: Message) {
  await kv.set(["messages", Date.now()], message);
}

// 获取历史消息
async function getHistory(): Promise<Message[]> {
  const messages = [];
  const entries = kv.list<Message>({ prefix: ["messages"] });
  for await (const entry of entries) {
    messages.push(entry.value);
  }
  return messages.reverse(); // 按时间倒序
}

// WebSocket 处理
router.get("/ws", async (ctx) => {
  const socket = await ctx.upgrade(); // 升级为 WebSocket 连接

  // 发送历史消息给新用户
  const history = await getHistory();
  socket.send(JSON.stringify({ type: "history", data: history }));

  // 监听新消息
  socket.onmessage = async (event) => {
    const message: Message = {
      text: event.data,
      timestamp: new Date().toISOString(),
      user: "Anonymous", // 可扩展为登录用户
    };
    await saveMessage(message);
    // 广播给所有连接的用户
    for (const client of ctx.app.wsServer.clients) {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "message", data: message }));
      }
    }
  };
});

// 静态文件托管
app.use(router.routes());
app.use(router.allowedMethods());
app.use(async (ctx) => {
  await ctx.send({
    root: `${Deno.cwd()}/static`,
    index: "index.html",
  });
});

// 启动服务器
console.log("Server running on http://localhost:8000");
await app.listen({ port: 8000 });