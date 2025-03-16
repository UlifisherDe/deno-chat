const socket = new WebSocket("ws://localhost:8000/ws");
const messagesDiv = document.getElementById("messages");
const input = document.getElementById("input");

// 接收消息
socket.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  if (type === "history") {
    data.forEach(addMessage);
  } else if (type === "message") {
    addMessage(data);
  }
};

// 添加消息到页面
function addMessage(msg) {
  const div = document.createElement("div");
  div.innerHTML = `
    <strong>${msg.user}</strong>
    <span>${new Date(msg.timestamp).toLocaleTimeString()}</span>
    <p>${msg.text}</p>
  `;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight; // 滚动到底部
}

// 发送消息
function sendMessage() {
  if (input.value.trim()) {
    socket.send(input.value);
    input.value = "";
  }
}

// 回车发送
input.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});