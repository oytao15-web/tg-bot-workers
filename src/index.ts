/**
 * Telegram Bot - Cloudflare Workers Entry Point
 * Uses webhook mode for Telegram Bot API
 */

import { Bot, webhookCallback, Context } from 'grammy';
import { Env } from './types';
import { setupCommands } from './commands';
import { setupHandlers } from './handlers';

// Telegram Bot API base URL
const TELEGRAM_API = 'https://api.telegram.org/bot';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Initialize bot
    const bot = new Bot(env.BOT_TOKEN);

    // Setup command handlers
    setupCommands(bot, env);
    
    // Setup message handlers
    setupHandlers(bot, env);

    // Handle webhook callback
    const handleUpdate = webhookCallback(bot, 'cloudflare-modern');
    
    try {
      return await handleUpdate(request);
    } catch (error) {
      console.error('Webhook error:', error);
      return new Response('OK', { status: 200 });
    }
  },

  // Scheduled task for cron triggers (e.g., scheduled announcements)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const bot = new Bot(env.BOT_TOKEN);
    
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
