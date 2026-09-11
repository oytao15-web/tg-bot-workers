# Cloudflare Workers 部署指南

## 架构说明

本项目从 Python (python-telegram-bot + polling) 迁移到 Cloudflare Workers (TypeScript + webhook) 架构：

| 原 Python 项目 | Cloudflare Workers 方案 |
|----------------|----------------------|
| python-telegram-bot | grammy (JS SDK) |
| aiosqlite + SQLite | Cloudflare D1 |
| polling 轮询 | Webhook 回调 |
| APScheduler 定时任务 | Cron Triggers |
| 本地文件存储 | Cloudflare KV |

## 前置条件

1. **Cloudflare 账号** - 注册 [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Node.js** - v18 或更高版本
3. **Wrangler CLI** - Cloudflare Workers 命令行工具
4. **Telegram Bot Token** - 从 [@BotFather](https://t.me/BotFather) 获取

## 部署步骤

### 1. 安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

### 3. 创建 D1 数据库

```bash
wrangler d1 create tg-bot-db
```

创建后会返回数据库 ID，将其更新到 `wrangler.toml` 的 `database_id` 字段。

### 4. 创建 KV 命名空间

```bash
wrangler kv:namespace create CACHE
```

创建后会返回 namespace ID，将其更新到 `wrangler.toml` 的 `id` 字段。

### 5. 初始化数据库

```bash
# 本地测试
wrangler d1 execute tg-bot-db --local --file=./schema.sql

# 远程数据库
wrangler d1 execute tg-bot-db --file=./schema.sql
```

### 6. 设置密钥

```bash
wrangler secret put BOT_TOKEN
# 输入你的 Telegram Bot Token

wrangler secret put BOT_USERNAME
# 输入你的 Bot 用户名 (不含 @)

wrangler secret put ADMIN_IDS
# 输入管理员 Telegram ID，多个用逗号分隔，如: 123456789,987654321
```

### 7. 本地开发测试

```bash
# 安装依赖
npm install

# 本地开发
npm run dev
```

### 8. 部署到 Cloudflare Workers

```bash
npm run deploy
```

部署成功后会获得一个 `*.workers.dev` 域名，如：`tg-bot-workers.your-subdomain.workers.dev`

### 9. 设置 Telegram Webhook

部署成功后，设置 Telegram webhook 指向你的 Worker：

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tg-bot-workers.your-subdomain.workers.dev/"}'
```

验证 webhook 状态：

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

## 项目结构

```
cloudflare-workers/
├── src/
│   ├── index.ts          # 入口文件 (webhook + cron)
│   ├── types.ts          # TypeScript 类型定义
│   ├── commands.ts       # 命令处理器
│   ├── handlers.ts       # 消息处理器
│   └── utils.ts          # 工具函数
├── schema.sql            # D1 数据库结构
├── package.json          # 项目依赖
├── tsconfig.json         # TypeScript 配置
├── wrangler.toml         # Workers 配置
├── .dev.vars            # 开发环境变量
└── DEPLOY.md             # 本文件
```

## 功能对照

| 功能 | Python 原项目 | Workers 实现 |
|-----|--------------|------------|
| 群组管理 | ✅ | ✅ |
| 审核 (ban/kick/mute/warn) | ✅ | ✅ |
| 欢迎消息 | ✅ | ✅ |
| 笔记系统 | ✅ | ✅ |
| 自动回复过滤器 | ✅ | ✅ |
| 内容锁定 | ✅ | ✅ |
| 公告管理 | ✅ | ✅ |
| 定时公告 | ✅ | ✅ (Cron) |
| 引流追踪 | ✅ | ✅ |
| 全局广播 | ✅ | ✅ |
| 用户信息 | ✅ | ✅ |

## 注意事项

1. **D1 限制**: D1 是 SQLite 数据库，不支持某些高级 SQL 特性
2. **KV 缓存**: 适合存储会话状态、临时数据
3. **Cron 触发器**: 最小间隔 10 分钟，不支持秒级定时
4. **Worker 限制**: 免费版有每日 100,000 次请求限制
5. **Webhook 模式**: 必须使用 HTTPS，Cloudflare Workers 自动提供

## 故障排除

### Webhook 不工作
- 检查 Worker 是否成功部署
- 验证 webhook URL 是否正确
- 查看 Worker 日志: `wrangler tail`

### D1 数据库错误
- 确认 database_id 正确
- 检查 SQL 语法是否兼容 SQLite
- 运行 `wrangler d1 execute tg-bot-db --file=./schema.sql` 重新初始化

### 密钥未生效
- 使用 `wrangler secret list` 检查密钥列表
- 重新部署: `wrangler deploy`
