class ChatApp {
  constructor() {
    this.socket = null;
    this.currentUser = null;
    this.initEventListeners();
    this.checkAuthStatus();
  }

  initEventListeners() {
    document.getElementById('reg-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleRegister();
    });

    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    document.getElementById('message-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendMessage();
    });
  }

  async checkAuthStatus() {
    const token = localStorage.getItem('chat-token');
    if (token) await this.initializeChat(token);
  }

  async handleRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();

    if (!username || !password) {
      this.showAlert('用户名和密码不能为空', 'error');
      return;
    }

    try {
      const response = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      if (!response.ok) throw data;

      this.showAlert('注册成功，请登录', 'success');
      document.getElementById('reg-username').value = '';
      document.getElementById('reg-password').value = '';

    } catch (error) {
      this.showAlert(error.error || '注册失败', 'error');
    }
  }

  async handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    try {
      const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const { token } = await response.json();
      localStorage.setItem('chat-token', token);
      await this.initializeChat(token);

    } catch (error) {
      this.showAlert('登录失败，请检查凭证', 'error');
    }
  }

  async initializeChat(token) {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('chat-section').classList.remove('hidden');
    this.connectWebSocket(token);
    this.loadMessageHistory();
  }

  connectWebSocket(token) {
    this.socket = new WebSocket(`wss://${window.location.host}/ws?token=${token}`);

    this.socket.onmessage = (event) => {
      const { type, data } = JSON.parse(event.data);
      if (type === 'history') this.renderMessages(data);
      if (type === 'message') this.renderMessage(data);
    };

    this.socket.onclose = () => {
      setTimeout(() => this.connectWebSocket(token), 5000);
    };
  }

  renderMessages(messages) {
    const container = document.getElementById('messages-container');
    container.innerHTML = messages.map(msg => `
      <div class="message">
        <div class="meta">
          <span class="user">${msg.user}</span>
          <span class="time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="content">${msg.encryptedText}</div>
      </div>
    `).join('');
  }

  renderMessage(message) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `
      <div class="meta">
        <span class="user">${message.user}</span>
        <span class="time">${new Date(message.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="content">${message.encryptedText}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  async sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;

    try {
      this.socket.send(content);
      input.value = '';
    } catch (error) {
      this.showAlert('消息发送失败', 'error');
    }
  }

  showAlert(message, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    document.body.prepend(alert);
    setTimeout(() => alert.remove(), 3000);
  }
}

// 启动应用
new ChatApp();
