/**
 * Visual Configuration Dashboard
 * Web-based settings panel for the Telegram bot
 */

import { Env } from './types';

const DASHBOARD_PASSWORD = 'admin123'; // Change this!

interface BotConfig {
  bot_token: string;
  bot_username: string;
  admin_ids: string;
  welcome_message: string;
  group_rules: string;
  announcement_footer: string;
}

const defaultConfig: BotConfig = {
  bot_token: '',
  bot_username: '',
  admin_ids: '',
  welcome_message: '欢迎 {first_name} 加入 {group_name}！',
  group_rules: '暂无群规',
  announcement_footer: '\n\n— 管理员',
};

// HTML for the dashboard
function getDashboardHTML(config: BotConfig, stats: any): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TG Bot 配置面板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { text-align: center; color: white; margin-bottom: 30px; }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; }
    .header p { opacity: 0.9; font-size: 1.1em; }
    .card { background: white; border-radius: 16px; padding: 30px; margin-bottom: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
    .card h2 { color: #333; margin-bottom: 20px; font-size: 1.4em; display: flex; align-items: center; gap: 10px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .stat-item { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 20px; border-radius: 12px; text-align: center; }
    .stat-value { font-size: 2em; font-weight: bold; }
    .stat-label { font-size: 0.9em; opacity: 0.9; margin-top: 5px; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; margin-bottom: 8px; color: #555; font-weight: 500; }
    .form-group input, .form-group textarea { width: 100%; padding: 12px 16px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 1em; transition: border-color 0.3s; }
    .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #667eea; }
    .form-group textarea { min-height: 100px; resize: vertical; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
    .btn { background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; padding: 14px 32px; border-radius: 10px; font-size: 1em; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4); }
    .btn:active { transform: translateY(0); }
    .btn-secondary { background: linear-gradient(135deg, #11998e, #38ef7d); }
    .alert { padding: 15px 20px; border-radius: 10px; margin-bottom: 20px; display: none; }
    .alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .alert-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    .section { margin-bottom: 30px; }
    .section-title { color: #667eea; font-size: 1.1em; font-weight: 600; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #f0f0f0; }
    .help-text { font-size: 0.85em; color: #888; margin-top: 5px; }
    .login-container { max-width: 400px; margin: 100px auto; }
    .logo { width: 80px; height: 80px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 20px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 2.5em; }
    @media (max-width: 600px) { .form-row { grid-template-columns: 1fr; } .stats-grid { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 TG Bot 配置面板</h1>
      <p>Telegram 群组管理机器人 - 可视化配置</p>
    </div>
    
    <div id="alert" class="alert"></div>
    
    <!-- Stats Card -->
    <div class="card">
      <h2>📊 数据统计</h2>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${stats.groups}</div>
          <div class="stat-label">群组数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.users}</div>
          <div class="stat-label">用户数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.warnings}</div>
          <div class="stat-label">警告数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.notes}</div>
          <div class="stat-label">笔记数</div>
        </div>
      </div>
    </div>
    
    <!-- Bot Config Card -->
    <div class="card">
      <h2>⚙️ 机器人配置</h2>
      <form id="configForm">
        <div class="section">
          <div class="section-title">基本设置</div>
          <div class="form-group">
            <label>Bot Token *</label>
            <input type="password" id="bot_token" value="${config.bot_token}" placeholder="从 @BotFather 获取">
            <div class="help-text">在 Telegram 搜索 @BotFather，发送 /newbot 创建机器人获取 Token</div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Bot 用户名</label>
              <input type="text" id="bot_username" value="${config.bot_username}" placeholder="不含 @，如 my_bot">
            </div>
            <div class="form-group">
              <label>管理员 ID</label>
              <input type="text" id="admin_ids" value="${config.admin_ids}" placeholder="如 123456789,987654321">
              <div class="help-text">多个管理员用逗号分隔，获取ID: @userinfobot</div>
            </div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">群组设置</div>
          <div class="form-group">
            <label>欢迎消息</label>
            <textarea id="welcome_message" placeholder="欢迎 {first_name} 加入 {group_name}！">${config.welcome_message}</textarea>
            <div class="help-text">可用变量: {first_name} = 用户名, {group_name} = 群名称</div>
          </div>
          <div class="form-group">
            <label>群规</label>
            <textarea id="group_rules" placeholder="请输入群规内容">${config.group_rules}</textarea>
          </div>
          <div class="form-group">
            <label>公告落款</label>
            <input type="text" id="announcement_footer" value="${config.announcement_footer}" placeholder="公告末尾签名">
          </div>
        </div>
        
        <button type="submit" class="btn">💾 保存配置</button>
      </form>
    </div>
    
    <!-- Webhook Card -->
    <div class="card">
      <h2>🔗 Webhook 设置</h2>
      <div class="form-group">
        <label>Webhook URL</label>
        <input type="text" id="webhookUrl" readonly>
      </div>
      <button class="btn btn-secondary" onclick="registerWebhook()">🚀 注册 Webhook</button>
      <div class="help-text" style="margin-top: 10px;">点击上方按钮自动设置 Telegram Webhook</div>
    </div>
  </div>
  
  <script>
    // Set webhook URL
    document.getElementById('webhookUrl').value = location.href.replace('/dashboard', '/register');
    
    // Show alert
    function showAlert(message, type) {
      const alert = document.getElementById('alert');
      alert.textContent = message;
      alert.className = 'alert alert-' + type;
      alert.style.display = 'block';
      setTimeout(() => alert.style.display = 'none', 5000);
    }
    
    // Save config
    document.getElementById('configForm').onsubmit = async (e) => {
      e.preventDefault();
      const data = {
        bot_token: document.getElementById('bot_token').value,
        bot_username: document.getElementById('bot_username').value,
        admin_ids: document.getElementById('admin_ids').value,
        welcome_message: document.getElementById('welcome_message').value,
        group_rules: document.getElementById('group_rules').value,
        announcement_footer: document.getElementById('announcement_footer').value,
      };
      
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        showAlert(result.message || '保存成功！', res.ok ? 'success' : 'error');
      } catch (err) {
        showAlert('保存失败: ' + err.message, 'error');
      }
    };
    
    // Register webhook
    async function registerWebhook() {
      try {
        const res = await fetch('/register');
        const text = await res.text();
        showAlert(text, res.ok ? 'success' : 'error');
      } catch (err) {
        showAlert('注册失败: ' + err.message, 'error');
      }
    }
  </script>
</body>
</html>`;
}

// Login page HTML
function getLoginHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - TG Bot 配置面板</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .login-box { background: white; border-radius: 20px; padding: 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
    .logo { width: 80px; height: 80px; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 20px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 2.5em; }
    h1 { text-align: center; color: #333; margin-bottom: 30px; }
    .form-group { margin-bottom: 20px; }
    .form-group label { display: block; margin-bottom: 8px; color: #555; font-weight: 500; }
    .form-group input { width: 100%; padding: 14px 16px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 1em; transition: border-color 0.3s; }
    .form-group input:focus { outline: none; border-color: #667eea; }
    .btn { width: 100%; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; padding: 14px; border-radius: 10px; font-size: 1.1em; cursor: pointer; transition: transform 0.2s; }
    .btn:hover { transform: translateY(-2px); }
    .error { color: #e74c3c; text-align: center; margin-top: 15px; display: none; }
  </style>
</head>
<body>
  <div class="login-box">
    <div class="logo">🤖</div>
    <h1>配置面板登录</h1>
    <form id="loginForm">
      <div class="form-group">
        <label>访问密码</label>
        <input type="password" id="password" placeholder="请输入密码" required>
      </div>
      <button type="submit" class="btn">登 录</button>
      <div id="error" class="error">密码错误</div>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        location.reload();
      } else {
        document.getElementById('error').style.display = 'block';
      }
    };
  </script>
</body>
</html>`;
}

// Get config from KV
async function getConfig(kv: KVNamespace): Promise<BotConfig> {
  const stored = await kv.get('bot_config');
  if (stored) {
    return JSON.parse(stored);
  }
  return { ...defaultConfig };
}

// Get stats from D1
async function getStats(db: D1Database): Promise<any> {
  try {
    const groups = await db.prepare('SELECT COUNT(*) as count FROM groups').first();
    const users = await db.prepare('SELECT COUNT(*) as count FROM users').first();
    const warnings = await db.prepare('SELECT COUNT(*) as count FROM warnings').first();
    const notes = await db.prepare('SELECT COUNT(*) as count FROM notes').first();
    return {
      groups: groups?.count || 0,
      users: users?.count || 0,
      warnings: warnings?.count || 0,
      notes: notes?.count || 0,
    };
  } catch {
    return { groups: 0, users: 0, warnings: 0, notes: 0 };
  }
}

// Handle dashboard request
export async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  
  // API routes
  if (url.pathname === '/api/login') {
    const { password } = (await request.json()) as { password: string };
    if (password === DASHBOARD_PASSWORD) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'auth=logged; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400' },
      });
    }
    return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  
  if (url.pathname === '/api/config') {
    // Check auth
    const cookie = request.headers.get('Cookie') || '';
    if (!cookie.includes('auth=logged')) {
      return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    if (request.method === 'GET') {
      const config = await getConfig(env.CACHE);
      return new Response(JSON.stringify(config), { headers: { 'Content-Type': 'application/json' } });
    }
    
    if (request.method === 'POST') {
      const config = await request.json();
      await env.CACHE.put('bot_config', JSON.stringify(config));
      return new Response(JSON.stringify({ message: '配置保存成功！' }), { headers: { 'Content-Type': 'application/json' } });
    }
  }
  
  // Check auth for dashboard page
  const cookie = request.headers.get('Cookie') || '';
  if (!cookie.includes('auth=logged')) {
    return new Response(getLoginHTML(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  
  // Show dashboard
  const config = await getConfig(env.CACHE);
  const stats = await getStats(env.DB);
  return new Response(getDashboardHTML(config, stats), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
