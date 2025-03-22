class AuthService {
  constructor() {
    this.initForms();
    this.checkToken();
  }

  initForms() {
    // 注册表单
    document.getElementById('reg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      await this.register(
        formData.get('username').trim(),
        formData.get('password').trim()
      );
    });

    // 登录表单
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      await this.login(
        formData.get('username').trim(),
        formData.get('password').trim()
      );
    });
  }

  async register(username, password) {
    try {
      const res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await res.json();
      if (!res.ok) throw data;
      
      this.showMessage('注册成功，请登录', 'success');
      document.getElementById('reg-form').reset();

    } catch (error) {
      this.showMessage(error.error || '注册失败', 'error');
    }
  }

  async login(username, password) {
    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        const error = await res.json();
        throw error;
      }

      const { token } = await res.json();
      localStorage.setItem('authToken', token);
      
      this.showMessage('登录成功，正在跳转...', 'success');
      setTimeout(() => window.location.href = '/chat', 1500);

    } catch (error) {
      this.showMessage(error.error || '登录失败', 'error');
      console.error('登录错误:', error);
    }
  }

  checkToken() {
    const token = localStorage.getItem('authToken');
    if (token) window.location.href = '/chat';
  }

  showMessage(text, type) {
    const div = document.createElement('div');
    div.className = `alert ${type}`;
    div.textContent = text;
    document.body.prepend(div);
    setTimeout(() => div.remove(), 3000);
  }
}

new AuthService();
