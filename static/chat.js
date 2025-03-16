// 用户登录状态
let currentUser = null;
let cryptoKey = null;

// 注册
async function register() {
  const username = document.getElementById("regUsername").value;
  const password = document.getElementById("regPassword").value;
  const response = await fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (response.ok) {
    alert("注册成功，请登录");
  } else {
    const error = await response.json();
    alert(error.error);
  }
}

// 登录并生成加密密钥
async function login() {
  const username = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;
  const response = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (response.ok) {
    const { token } = await response.json();
    currentUser = username;
    localStorage.setItem("token", token);

    // 从密码派生加密密钥
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    cryptoKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: encoder.encode(username), iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    initChat();
  } else {
    const error = await response.json();
    alert(error.error);
  }
}

// 加密消息
async function encryptMessage(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoder.encode(text)
  );
  return {
    encryptedText: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

// 解密消息
async function decryptMessage(encryptedText, iv) {
  const encryptedData = Uint8Array.from(atob(encryptedText), c => c.charCodeAt(0));
  const ivData = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivData },
    cryptoKey,
    encryptedData
  );
  return new TextDecoder().decode(decrypted);
}

// 初始化聊天
function initChat() {
  document.getElementById("auth").style.display = "none";
  document.getElementById("chat").style.display = "block";

  const token = localStorage.getItem("token");
  const socket = new WebSocket(`ws://${window.location.host}/ws?token=${token}`);

  socket.onmessage = async (event) => {
    const { type, data } = JSON.parse(event.data);
    if (type === "history") {
      for (const msg of data) {
        const text = await decryptMessage(msg.encryptedText, msg.iv);
        addMessage({ ...msg, text });
      }
    } else if (type === "message") {
      const text = await decryptMessage(data.encryptedText, data.iv);
      addMessage({ ...data, text });
    }
  };

  // 发送加密消息
  window.sendMessage = async () => {
    const input = document.getElementById("input");
    if (input.value.trim()) {
      const { encryptedText, iv } = await encryptMessage(input.value);
      socket.send(JSON.stringify({ encryptedText, iv }));
      input.value = "";
    }
  };
}

// 分页加载历史
async function loadHistory(page) {
  const response = await fetch(`/history?page=${page}`);
  const messages = await response.json();
  for (const msg of messages) {
    const text = await decryptMessage(msg.encryptedText, msg.iv);
    addMessage({ ...msg, text });
  }
}
