let currentUser = null;
let cryptoKey = null;
let socket = null;
let currentPage = 1;

// 注册功能
async function register() {
  try {
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    
    const response = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const result = await response.json();
    if (response.ok) {
      alert('注册成功，请登录');
      document.getElementById('regUsername').value = '';
      document.getElementById('regPassword').value = '';
    } else {
      alert(result.error);
    }
  } catch (error) {
    alert('网络错误，请稍后重试');
  }
}

// 登录功能
async function login() {
  try {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const result = await response.json();
    if (response.ok) {
      localStorage.setItem('token', result.token);
      await initializeCryptoKey(username, password);
      initializeChat();
    } else {
      alert(result.error);
    }
  } catch (error) {
    alert('登录失败，请检查网络');
  }
}

// 初始化加密密钥
async function initializeCryptoKey(username, password) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  
  cryptoKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(username),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// 初始化聊天
function initializeChat() {
  document.getElementById('auth').style.display = 'none';
  document.getElementById('chat').style.display = 'block';
  
  connectWebSocket();
  loadHistory(currentPage);
}

// WebSocket连接
function connectWebSocket() {
  const token = localStorage.getItem('token');
  socket = new WebSocket(`wss://${window.location.host}/ws?token=${token}`);

  socket.onmessage = async (event) => {
    try {
      const { type, data } = JSON.parse(event.data);
      if (type === 'history') {
        data.forEach(async msg => addMessage(await decryptMessage(msg)));
      } else if (type === 'message') {
        addMessage(await decryptMessage(data));
      }
    } catch (error) {
      console.error('消息处理失败:', error);
    }
  };

  socket.onclose = () => {
    console.log('连接断开，5秒后重连...');
    setTimeout(connectWebSocket, 5000);
  };
}

// 加密消息
async function encryptMessage(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(text);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encodedText
  );
  return {
    encryptedText: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv)
  };
}

// 解密消息
async function decryptMessage(msg) {
  try {
    const encryptedData = base64ToArrayBuffer(msg.encryptedText);
    const iv = base64ToArrayBuffer(msg.iv);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encryptedData
    );
    return {
      ...msg,
      text: new TextDecoder().decode(decrypted),
      decrypted: true
    };
  } catch (error) {
    console.error('解密失败:', error);
    return { ...msg, text: '无法解密的消息', decrypted: false };
  }
}

// 添加消息到界面
function addMessage(msg) {
  const messagesDiv = document.getElementById('messages');
  const messageEl = document.createElement('div');
  messageEl.className = 'message';
  messageEl.innerHTML = `
    <div class="message-header">
      <span class="username">${msg.user}</span>
      <span class="timestamp">${new Date(msg.timestamp).toLocaleString()}</span>
    </div>
    <div class="message-content">${msg.text}</div>
  `;
  
  if (!msg.decrypted) {
    messageEl.style.opacity = '0.6';
    messageEl.querySelector('.message-content').style.color = '#ef4444';
  }
  
  messagesDiv.appendChild(messageEl);
  autoScroll();
}

// 自动滚动
function autoScroll() {
  const messagesDiv = document.getElementById('messages');
  const isScrolledToBottom = 
    messagesDiv.scrollHeight - messagesDiv.clientHeight <= messagesDiv.scrollTop + 50;
  if (isScrolledToBottom) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
}

// 发送消息
async function sendMessage() {
  const input = document.getElementById('input');
  if (input.value.trim()) {
    try {
      const { encryptedText, iv } = await encryptMessage(input.value);
      socket.send(JSON.stringify({ encryptedText, iv }));
      input.value = '';
    } catch (error) {
      alert('消息发送失败');
    }
  }
}

// 加载更多历史
async function loadMore() {
  currentPage++;
  const response = await fetch(`/history?page=${currentPage}`);
  const messages = await response.json();
  messages.forEach(async msg => addMessage(await decryptMessage(msg)));
}

// 工具函数
function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
