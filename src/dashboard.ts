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

// D1 schema initialization SQL (idempotent, safe to run multiple times)
const INIT_DB_SQL = `
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    username TEXT,
    description TEXT,
    invite_link TEXT,
    language TEXT DEFAULT 'zh',
    welcome_message TEXT,
    rules TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT,
    language_code TEXT DEFAULT 'zh',
    reputation INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    admin_id INTEGER NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    content TEXT NOT NULL,
    file_id TEXT,
    file_type TEXT,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    response TEXT NOT NULL,
    is_regex INTEGER DEFAULT 0,
    action TEXT DEFAULT 'reply',
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE filters ADD COLUMN action TEXT DEFAULT 'reply';
CREATE TABLE IF NOT EXISTS group_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    lock_type TEXT NOT NULL,
    is_locked INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invite_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    link TEXT NOT NULL UNIQUE,
    name TEXT,
    created_by INTEGER NOT NULL,
    max_uses INTEGER DEFAULT 0,
    current_uses INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invite_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_link_id INTEGER NOT NULL,
    invited_user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    file_id TEXT,
    file_type TEXT,
    created_by INTEGER NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS scheduled_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    scheduled_time DATETIME NOT NULL,
    is_sent INTEGER DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS announcement_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS antiflood_settings (
    group_id INTEGER PRIMARY KEY,
    max_messages INTEGER DEFAULT 5,
    time_window INTEGER DEFAULT 10,
    action TEXT DEFAULT 'mute'
);
CREATE INDEX IF NOT EXISTS idx_warnings_group ON warnings(group_id);
CREATE INDEX IF NOT EXISTS idx_notes_group_keyword ON notes(group_id, keyword);
CREATE INDEX IF NOT EXISTS idx_filters_group ON filters(group_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_group ON action_logs(group_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_time ON scheduled_announcements(scheduled_time, is_sent);
CREATE INDEX IF NOT EXISTS idx_invite_link ON invite_links(link);
`;

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
    .filter-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #f8f9fa; border-radius: 8px; margin-bottom: 8px; }
    .btn-small { background: #e74c3c; color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.85em; }
    .btn-small:hover { background: #c0392b; }
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

    <!-- Filters Card -->
    <div class="card">
      <h2>🚫 违禁词管理</h2>
      <div class="form-group">
        <label>选择群组</label>
        <select id="filterGroup" class="form-group"></select>
        <div class="help-text">选择群组后，下方显示该群的违禁词/过滤器</div>
      </div>
      <div id="filterList" style="margin-bottom: 20px;"></div>
      <div class="section">
        <div class="section-title">添加违禁词</div>
        <div class="form-group">
          <label>关键词</label>
          <input type="text" id="newFilterKeyword" placeholder="如: 加微信">
        </div>
        <div class="form-group">
          <label>处理方式</label>
          <select id="newFilterAction" onchange="toggleReplyInput()">
            <option value="delete">🚫 自动撤回（命中即删除消息）</option>
            <option value="reply">💬 自动回复（命中即回复预设内容）</option>
          </select>
        </div>
        <div class="form-group" id="replyContentGroup" style="display:none;">
          <label>回复内容</label>
          <input type="text" id="newFilterResponse" placeholder="匹配后自动回复的内容">
        </div>
        <button class="btn" onclick="addFilter()">➕ 添加违禁词</button>
      </div>
    </div>

    <!-- Database Card -->
    <div class="card">
      <h2>🗄️ 数据库</h2>
      <div class="form-group">
        <label>D1 数据库初始化</label>
        <button class="btn btn-secondary" onclick="initDb()">🗄️ 一键初始化数据库</button>
        <div class="help-text" style="margin-top: 10px;">首次使用前必须执行。如果机器人提示 "no such table"，点这里即可自动建表（重复执行安全）。</div>
      </div>
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

    // Init database
    async function initDb() {
      try {
        const res = await fetch('/api/init-db', { method: 'POST' });
        const result = await res.json();
        showAlert(result.message || result.error || '初始化完成', res.ok ? 'success' : 'error');
      } catch (err) {
        showAlert('初始化失败: ' + err.message, 'error');
      }
    }

    // === Filter (违禁词) management ===
    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toggleReplyInput() {
      const isReply = document.getElementById('newFilterAction').value === 'reply';
      document.getElementById('replyContentGroup').style.display = isReply ? 'block' : 'none';
    }

    async function loadFilterGroups() {
      try {
        const res = await fetch('/api/groups');
        if (!res.ok) {
          const err = await res.json();
          showAlert(err.error || '加载群组失败', 'error');
          return;
        }
        const groups = await res.json();
        const select = document.getElementById('filterGroup');
        select.innerHTML = '';
        if (!groups || groups.length === 0) {
          select.innerHTML = '<option value="">暂无群组（先把机器人加入群聊）</option>';
          document.getElementById('filterList').innerHTML = '<p style="color:#888;">暂无数据</p>';
          return;
        }
        groups.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.title;
          select.appendChild(opt);
        });
        select.onchange = loadFilters;
        loadFilters();
      } catch (err) {
        showAlert('加载群组失败: ' + err.message, 'error');
      }
    }

    async function loadFilters() {
      const groupId = document.getElementById('filterGroup').value;
      const list = document.getElementById('filterList');
      if (!groupId) return;
      try {
        const res = await fetch('/api/filters?group_id=' + groupId);
        if (!res.ok) {
          const err = await res.json();
          if (err.needInit) {
            list.innerHTML = '<p style="color:#e74c3c;">⚠️ 数据库未初始化或缺少字段，请点击下方「一键初始化数据库」</p>';
          } else {
            list.innerHTML = '<p style="color:#e74c3c;">加载失败: ' + escapeHtml(err.error || '') + '</p>';
          }
          return;
        }
        const filters = await res.json();
        if (!filters || filters.length === 0) {
          list.innerHTML = '<p style="color:#888;">暂无违禁词/过滤器</p>';
          return;
        }
        list.innerHTML = '<div style="font-weight:600;color:#555;margin-bottom:10px;">当前过滤器 (' + filters.length + ')</div>' +
          filters.map(function(f) {
            return '<div class="filter-item">' +
              '<span>' + (f.action === 'delete' ? '🚫' : '💬') + ' <b>#' + escapeHtml(f.keyword) + '</b></span>' +
              '<button class="btn-small" data-del-keyword="' + encodeURIComponent(f.keyword) + '">删除</button>' +
              '</div>';
          }).join('');
        list.querySelectorAll('[data-del-keyword]').forEach(btn => {
          btn.onclick = () => deleteFilter(groupId, decodeURIComponent(btn.dataset.delKeyword));
        });
      } catch (err) {
        list.innerHTML = '<p style="color:#e74c3c;">加载失败: ' + escapeHtml(err.message) + '</p>';
      }
    }

    async function addFilter() {
      const groupId = document.getElementById('filterGroup').value;
      const keyword = document.getElementById('newFilterKeyword').value.trim().toLowerCase();
      const action = document.getElementById('newFilterAction').value;
      const response = document.getElementById('newFilterResponse').value.trim();
      if (!groupId) { showAlert('请先选择群组', 'error'); return; }
      if (!keyword) { showAlert('请填写关键词', 'error'); return; }
      if (action === 'reply' && !response) { showAlert('自动回复需要填写回复内容', 'error'); return; }
      try {
        const res = await fetch('/api/filters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: Number(groupId), keyword, action, response }),
        });
        const result = await res.json();
        showAlert(result.message || result.error || '完成', res.ok ? 'success' : 'error');
        if (res.ok) {
          document.getElementById('newFilterKeyword').value = '';
          document.getElementById('newFilterResponse').value = '';
          loadFilters();
        }
      } catch (err) {
        showAlert('添加失败: ' + err.message, 'error');
      }
    }

    async function deleteFilter(groupId, keyword) {
      try {
        const res = await fetch('/api/filters', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: Number(groupId), keyword }),
        });
        const result = await res.json();
        showAlert(result.message || result.error || '完成', res.ok ? 'success' : 'error');
        if (res.ok) loadFilters();
      } catch (err) {
        showAlert('删除失败: ' + err.message, 'error');
      }
    }

    // Load filter groups on dashboard load
    loadFilterGroups();
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
async function getConfig(kv: KVNamespace | undefined): Promise<BotConfig> {
  if (!kv) return { ...defaultConfig };
  const stored = await kv.get('bot_config');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return { ...defaultConfig };
    }
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
      try {
        if (!env.CACHE) {
          return new Response(JSON.stringify({ error: 'KV 绑定 (CACHE) 未配置！请在 Cloudflare 控制台添加 KV 绑定' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        const config = await request.json();
        await env.CACHE.put('bot_config', JSON.stringify(config));
        return new Response(JSON.stringify({ message: '配置保存成功！' }), { headers: { 'Content-Type': 'application/json' } });
      } catch (error: any) {
        console.error('Save config error:', error);
        return new Response(JSON.stringify({ error: `保存失败: ${error?.message || error}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
  }
  
  // Groups list (for filter management)
  if (url.pathname === '/api/groups') {
    const cookie = request.headers.get('Cookie') || '';
    if (!cookie.includes('auth=logged')) {
      return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    try {
      if (!env.DB) {
        return new Response(JSON.stringify({ error: 'D1 绑定 (DB) 未配置！', needInit: true }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      const { results } = await env.DB.prepare(`SELECT id, title FROM groups ORDER BY title`).all();
      return new Response(JSON.stringify(results || []), { headers: { 'Content-Type': 'application/json' } });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: `查询失败: ${error?.message || error}`, needInit: true }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Filters management (违禁词/过滤器)
  if (url.pathname === '/api/filters') {
    const cookie = request.headers.get('Cookie') || '';
    if (!cookie.includes('auth=logged')) {
      return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'GET') {
      const groupId = Number(url.searchParams.get('group_id'));
      if (!groupId) {
        return new Response(JSON.stringify({ error: '缺少 group_id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      try {
        const { results } = await env.DB.prepare(`
          SELECT id, keyword, action, response FROM filters WHERE group_id = ? ORDER BY keyword
        `).bind(groupId).all();
        return new Response(JSON.stringify(results || []), { headers: { 'Content-Type': 'application/json' } });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: `查询失败: ${error?.message || error}`, needInit: true }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (request.method === 'POST') {
      try {
        const body = await request.json() as { group_id?: number; keyword?: string; action?: string; response?: string };
        const { group_id, keyword, action, response } = body;
        if (!group_id || !keyword) {
          return new Response(JSON.stringify({ error: '缺少群组或关键词' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const act = action === 'delete' ? 'delete' : 'reply';
        const resp = act === 'delete' ? '' : (response || '');
        await env.DB.prepare(`
          INSERT INTO filters (group_id, keyword, response, action, created_by) VALUES (?, ?, ?, ?, ?)
        `).bind(group_id, String(keyword).toLowerCase(), resp, act, 0).run();
        return new Response(JSON.stringify({
          message: act === 'delete' ? `✅ 已添加撤回违禁词 #${keyword}，命中后自动删除消息。` : `✅ 已添加自动回复 #${keyword}。`
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: `添加失败: ${error?.message || error}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (request.method === 'DELETE') {
      try {
        const body = await request.json() as { group_id?: number; keyword?: string };
        const { group_id, keyword } = body;
        if (!group_id || !keyword) {
          return new Response(JSON.stringify({ error: '缺少群组或关键词' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        await env.DB.prepare(`DELETE FROM filters WHERE group_id = ? AND keyword = ?`)
          .bind(group_id, String(keyword).toLowerCase()).run();
        return new Response(JSON.stringify({ message: `✅ 已删除 #${keyword}` }), { headers: { 'Content-Type': 'application/json' } });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: `删除失败: ${error?.message || error}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
  }

  // Init database tables
  if (url.pathname === '/api/init-db') {
    const cookie = request.headers.get('Cookie') || '';
    if (!cookie.includes('auth=logged')) {
      return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    if (request.method === 'POST') {
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: 'D1 绑定 (DB) 未配置！请在 Cloudflare 控制台添加 D1 绑定' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        // D1 exec() fails on multi-statement SQL, so run each statement individually
        const statements = INIT_DB_SQL.split(';').map(s => s.trim()).filter(Boolean);
        for (const sql of statements) {
          if (sql.toUpperCase().startsWith('ALTER TABLE')) {
            try { await env.DB.prepare(sql).run(); } catch { /* column already exists */ }
          } else {
            await env.DB.prepare(sql).run();
          }
        }
        return new Response(JSON.stringify({ message: '数据库初始化成功！所有表已创建。' }), { headers: { 'Content-Type': 'application/json' } });
      } catch (error: any) {
        console.error('Init DB error:', error);
        return new Response(JSON.stringify({ error: `初始化失败: ${error?.message || error}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
  }
  
  // Check auth for dashboard page
  const cookie = request.headers.get('Cookie') || '';
  if (!cookie.includes('auth=logged')) {
    return new Response(getLoginHTML(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  
  // Show dashboard
  try {
    const config = await getConfig(env.CACHE);
    const stats = await getStats(env.DB);
    return new Response(getDashboardHTML(config, stats), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error: any) {
    return new Response(
      `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>配置错误</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .box { background: white; border-radius: 16px; padding: 40px; max-width: 600px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
    h1 { color: #e74c3c; font-size: 1.5em; margin-bottom: 20px; }
    pre { background: #f1f3f5; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 0.9em; }
    ol { color: #555; line-height: 1.8; }
    code { background: #e9ecef; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>⚠️ 配置面板加载失败</h1>
    <p>错误信息：</p>
    <pre>${String(error?.message || error).replace(/</g, '&lt;')}</pre>
    <p>常见原因及解决方法：</p>
    <ol>
      <li><b>KV 绑定未配置</b>：在 Cloudflare 控制台 → Workers → 你的 Worker → Settings → Bindings，确认存在 <code>CACHE</code> 绑定并关联真实的 KV 命名空间</li>
      <li><b>D1 绑定未配置</b>：同样在 Bindings 里确认存在 <code>DB</code> 绑定并关联真实的 D1 数据库</li>
      <li><b>D1 表未初始化</b>：在 D1 控制台执行 <code>schema.sql</code> 建表语句</li>
    </ol>
  </div>
</body>
</html>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
