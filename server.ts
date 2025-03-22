import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";

// 定义消息类型
interface Message {
  text: string;
  timestamp: string;
  user?: string;
}

// 初始化 Deno KV 数据库
const kv = await Deno.openKv();

// 创建 Oak 应用
const app = new Application();
const router = new Router();

// 保存消息到数据库
async function saveMessage(message: Message) {
  await kv.set(["messages", Date.now()], message);
}

// 获取历史消息
async function getHistory(): Promise<Message[]> {
  const messages: Message[] = [];
  const entries = kv.list<Message>({ prefix: ["messages"] });
  for await (const entry of entries) {
    messages.push(entry.value);
  }
  return messages.reverse(); // 最新消息在前
}

// WebSocket 实时通信
router.get("/ws", async (ctx) => {
  const socket = await ctx.upgrade();

  // 发送历史消息给新用户
  const history = await getHistory();
  socket.send(JSON.stringify({ type: "history", data: history }));

  // 监听新消息
  socket.onmessage = async (event) => {
    const message: Message = {
      text: event.data,
      timestamp: new Date().toISOString(),
      user: "Anonymous",
    };
    await saveMessage(message);

    // 广播给所有客户端（包括自己）
    for (const client of ctx.app.wsServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "message", data: message }));
      }
    }
  };
});

// 静态文件托管（修正路径）
app.use(router.routes());
app.use(router.allowedMethods());
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
