/**
 * Telegram Bot - Cloudflare Workers Entry Point
 * Uses webhook mode for Telegram Bot API
 * Includes visual configuration dashboard
 */

import { Bot, webhookCallback, Context } from 'grammy';
import { Env } from './types';
import { setupCommands } from './commands';
import { setupHandlers } from './handlers';
import { handleDashboard } from './dashboard';

// Telegram Bot API base URL
const TELEGRAM_API = 'https://api.telegram.org/bot';

// Get bot config from KV or fallback to env
async function getBotConfig(env: Env): Promise<{ token: string; username: string; adminIds: string }> {
  try {
    const stored = await env.CACHE.get('bot_config');
    if (stored) {
      const config = JSON.parse(stored);
      return {
        token: config.bot_token || env.BOT_TOKEN,
        username: config.bot_username || env.BOT_USERNAME,
        adminIds: config.admin_ids || env.ADMIN_IDS,
      };
    }
  } catch (e) {
    console.error('Failed to read config from KV:', e);
  }
  return {
    token: env.BOT_TOKEN,
    username: env.BOT_USERNAME,
    adminIds: env.ADMIN_IDS,
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Dashboard routes
    if (url.pathname === '/dashboard' || url.pathname.startsWith('/api/')) {
      return handleDashboard(request, env);
    }

    // Webhook register route
    if (url.pathname === '/register') {
      const config = await getBotConfig(env);
      if (!config.token) {
        return new Response('Error: Bot Token not configured. Please set it in /dashboard', { status: 400 });
      }
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${config.token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (data.ok) {
        return new Response('✅ Webhook registered successfully!\nURL: ' + webhookUrl);
      }
      return new Response('❌ Failed: ' + JSON.stringify(data), { status: 500 });
    }

    // Webhook endpoint
    if (url.pathname === '/webhook') {
      const config = await getBotConfig(env);
      if (!config.token) {
        return new Response('Bot Token not configured', { status: 500 });
      }

      // Initialize bot with KV config
      const bot = new Bot(config.token);

      // Override env with KV config
      const dynamicEnv: Env = {
        ...env,
        BOT_TOKEN: config.token,
        BOT_USERNAME: config.username,
        ADMIN_IDS: config.adminIds,
      };

      // Setup command handlers
      setupCommands(bot, dynamicEnv);

      // Setup message handlers
      setupHandlers(bot, dynamicEnv);

      // Handle webhook callback
      const handleUpdate = webhookCallback(bot, 'cloudflare-mod');

      try {
        return await handleUpdate(request);
      } catch (error) {
        console.error('Webhook error:', error);
        return new Response('OK', { status: 200 });
      }
    }

    // Default response
    return new Response(
      `<h1>🤖 Telegram Bot Worker</h1>
<p>Status: Running</p>
<p><a href="/dashboard">⚙️ Configuration Dashboard</a></p>
<p><a href="/register">🔗 Register Webhook</a></p>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  },

  // Scheduled task for cron triggers (e.g., scheduled announcements)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = await getBotConfig(env);
    const bot = new Bot(config.token);

    // Check and send scheduled announcements
    await checkScheduledAnnouncements(bot, env);
  }
};

/**
 * Check and send scheduled announcements
 */
async function checkScheduledAnnouncements(bot: Bot, env: Env): Promise<void> {
  const now = new Date().toISOString();

  // Get pending scheduled announcements
  const { results } = await env.DB.prepare(`
    SELECT * FROM scheduled_announcements 
    WHERE is_sent = 0 AND scheduled_time <= ?
    ORDER BY scheduled_time ASC
    LIMIT 10
  `).bind(now).all();

  if (!results || results.length === 0) return;

  for (const announcement of results) {
    try {
      await bot.api.sendMessage(
        announcement.group_id as number,
        announcement.content as string,
        { parse_mode: 'HTML' }
      );

      // Mark as sent
      await env.DB.prepare(`
        UPDATE scheduled_announcements SET is_sent = 1 WHERE id = ?
      `).bind(announcement.id).run();
    } catch (error) {
      console.error(`Failed to send announcement ${announcement.id}:`, error);
    }
  }
}
