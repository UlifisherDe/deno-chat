class ChatClient {
  constructor() {
    this.socket = null;
    this.currentUser = null;
    this.cryptoKey = null;
    this.page = 1;
  }

  async init() {
    const token = localStorage.getItem('chat-token');
    if (token) await this.reconnect(token);
  }

  async reconnect(token) {
    try {
      const payload = JSON.parse(atob(token));
      if (Date.now() > payload.exp) throw new Error('Token过期');
      
      this.currentUser = payload.username;
      this.initCrypto(payload.username);
      this.showChatUI();
      this.connectWebSocket(token);
      this.loadMessages();
    } catch {
      this.logout();
    }
  }

  async handleRegister() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;

    try {
      const res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (!res.ok) throw await res.json();
      alert('注册成功，请登录');
    } catch (error) {
      alert(error.error || '注册失败');
    }
  }

  async handleLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const { token } = await res.json();
      localStorage.setItem('chat-token', token);
      await this.reconnect(token);
    } catch {
      alert('登录失败');
    }
  }

  connectWebSocket(token) {
    this.socket = new WebSocket(`wss://${window.location.host}/ws?token=${token}`);

    this.socket.onmessage = async (event) => {
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

  async displayMessage(msg) {
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.innerHTML = `
      <div class="message-header">
        <span class="username">${msg.user}</span>
        <span class="timestamp">${new Date(msg.timestamp).toLocaleString()}</span>
      </div>
      <div class="message-content">${msg.encryptedText}</div>
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

  async loadMore() {
    this.page++;
    const messages = await fetch(`/messages?page=${this.page}`).then(res => res.json());
    messages.forEach(msg => this.displayMessage(msg));
  }

  autoScroll() {
    const messagesDiv = document.getElementById('messages');
    if (messagesDiv.scrollHeight - messagesDiv.scrollTop < 800) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }

  showChatUI() {
    document.getElementById('auth-ui').style.display = 'none';
    document.getElementById('chat-ui').style.display = 'block';
  }

  logout() {
    localStorage.removeItem('chat-token');
    window.location.reload();
  }

  async initCrypto(username) {
    // 加密初始化逻辑
  }
}

// 启动应用
const chat = new ChatClient();
chat.init();
