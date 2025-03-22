class ChatApp {
  constructor() {
    this.socket = null;
    this.currentUser = null;
    this.page = 1;
    this.initEventListeners();
  }

  initEventListeners() {
    document.getElementById('reg-btn').addEventListener('click', () => this.register());
    document.getElementById('login-btn').addEventListener('click', () => this.login());
    document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());
  }

  async register() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;

    try {
      const response = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) throw await response.json();
      alert('注册成功，请登录');
    } catch (error) {
      alert(error.error || '注册失败');
    }
  }

  async login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const { token } = await response.json();
      localStorage.setItem('chat-token', token);
      this.initChat(token);
    } catch {
      alert('登录失败');
    }
  }

  initChat(token) {
    document.getElementById('auth').style.display = 'none';
    document.getElementById('chat').style.display = 'block';
    this.connectWebSocket(token);
    this.loadHistory();
  }

  connectWebSocket(token) {
    this.socket = new WebSocket(`wss://${window.location.host}/ws?token=${token}`);

    this.socket.onmessage = (event) => {
      const { type, data } = JSON.parse(event.data);
      if (type === 'history') {
        data.forEach(msg => this.displayMessage(msg));
      } else if (type === 'message') {
        this.displayMessage(data);
      }
    };

    this.socket.onclose = () => {
      setTimeout(() => this.connectWebSocket(token), 5000);
    };
  }

  displayMessage(msg) {
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.innerHTML = `
      <div class="message-header">
        <span class="user">${msg.user}</span>
        <span class="timestamp">${new Date(msg.timestamp).toLocaleString()}</span>
      </div>
      <div class="content">${msg.encryptedText}</div>
    `;
    messagesDiv.appendChild(messageEl);
    this.autoScroll();
  }

  async sendMessage() {
    const input = document.getElementById('message-input');
    if (!input.value.trim()) return;

    try {
      this.socket.send(input.value);
      input.value = '';
    } catch (error) {
      alert('消息发送失败');
    }
  }

  async loadHistory() {
    const response = await fetch(`/messages?page=${this.page}`);
    const messages = await response.json();
    messages.forEach(msg => this.displayMessage(msg));
  }

  autoScroll() {
    const messagesDiv = document.getElementById('messages');
    if (messagesDiv.scrollHeight - messagesDiv.scrollTop < 800) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }
}

// 启动应用
new ChatApp();
