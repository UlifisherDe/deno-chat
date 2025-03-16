// 动态设置 WebSocket 协议和主机
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

const messagesDiv = document.getElementById("messages");
const input = document.getElementById("input");

// 接收消息
socket.onmessage = (event) => {
  try {
    const { type, data } = JSON.parse(event.data);
    if (type === "history") {
      data.forEach(addMessage);
    } else if (type === "message") {
      addMessage(data);
    }
  } catch (error) {
    console.error("消息解析失败:", error);
  }
};

// 添加消息到页面
function addMessage(msg) {
  const div = document.createElement("div");
  div.className = "message";
  div.innerHTML = `
    <span class="user">${msg.user || '匿名用户'}</span>
    <span class="time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
    <p>${msg.text}</p>
  `;
  messagesDiv.appendChild(div);
  // 自动滚动到底部
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 发送消息
function sendMessage() {
  if (input.value.trim()) {
    socket.send(input.value);
    input.value = "";
    input.focus();
  }
}

// 回车发送
input.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});
