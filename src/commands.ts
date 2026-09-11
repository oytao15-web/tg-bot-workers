/**
 * Command handlers for the Telegram Bot
 */

import { Bot, Context } from 'grammy';
import { Env } from './types';
import { isGroupAdmin } from './utils';

export function setupCommands(bot: Bot, env: Env): void {

  // Global error middleware: surface command errors instead of silent failure
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error: any) {
      console.error('Command error:', error);
      try {
        await ctx.reply(`⚠️ 命令执行出错: ${error?.message || '未知错误'}\n\n如果提示数据库相关，请在 D1 Console 执行 schema.sql 初始化表结构。`);
      } catch {
        // Ignore reply failures
      }
    }
  });

  // === Basic Commands ===

  bot.command('start', async (ctx: Context) => {
    const chatType = ctx.chat?.type;

    if (chatType === 'private') {
      // Private chat - show welcome message
      await ctx.reply(
        `👋 你好！我是群组管理机器人。\n\n` +
        `将我添加到你的群组，即可使用以下功能：\n\n` +
        `🛡️ 审核管理 - 踢除、禁言、警告\n` +
        `📝 笔记系统 - 保存和检索消息\n` +
        `🔍 自动回复 - 关键词触发回复\n` +
        `📢 公告管理 - 发送群组公告\n` +
        `📊 引流追踪 - 邀请链接统计\n\n` +
        `使用 /help 查看所有命令`,
        { parse_mode: 'HTML' }
      );
    } else {
      // Group chat
      const groupId = ctx.chat!.id;

      // Add group to database if not exists
      await env.DB.prepare(`
        INSERT OR IGNORE INTO groups (id, title) VALUES (?, ?)
      `).bind(groupId, ctx.chat!.title || 'Unknown').run();

      await ctx.reply('👋 机器人已启动！使用 /help 查看可用命令。');
    }
  });

  bot.command('help', async (ctx: Context) => {
    const helpText = getHelpText();
    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });

  // === Admin Commands ===

  bot.command('admin', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;

    const userId = ctx.from?.id;
    if (!userId) return;

    // Check if user is group admin or bot admin
    const isBotAdmin = (env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean).includes(userId);
    const isGroupAdm = await isGroupAdmin(ctx, userId);

    if (!isBotAdmin && !isGroupAdm) {
      await ctx.reply('❌ 你没有权限使用此命令。');
      return;
    }

    await ctx.reply(
      `⚙️ 管理面板\n\n` +
      `📊 /stats - 群组统计\n` +
      `📢 /announce - 发送公告\n` +
      `🔗 /invitelink - 邀请链接\n` +
      `📈 /growth - 增长统计\n` +
      `📋 /broadcast - 全局广播 (仅机器人管理员)`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('stats', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;

    const groupId = ctx.chat.id;

    // Get group stats
    const memberCount = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM group_members WHERE group_id = ?
    `).bind(groupId).first<{ count: number }>();

    const warningCount = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM warnings WHERE group_id = ?
    `).bind(groupId).first<{ count: number }>();

    const noteCount = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM notes WHERE group_id = ?
    `).bind(groupId).first<{ count: number }>();

    await ctx.reply(
      `📊 <b>${ctx.chat.title}</b> 群组统计\n\n` +
      `👥 成员数量: ${memberCount?.count || 0}\n` +
      `⚠️ 警告总数: ${warningCount?.count || 0}\n` +
      `📝 笔记数量: ${noteCount?.count || 0}`,
      { parse_mode: 'HTML' }
    );
  });

  // === Moderation Commands ===

  bot.command('ban', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const targetUser = ctx.message?.reply_to_message?.from;
    if (!targetUser) {
      await ctx.reply('❌ 请回复要封禁的用户消息。');
      return;
    }

    try {
      await ctx.banChatMember(targetUser.id);
      await ctx.reply(`🚫 用户 ${targetUser.first_name} 已被封禁。`);

      // Log action
      await logAction(env, ctx.chat.id, ctx.from!.id, 'ban', `Banned user ${targetUser.id}`);
    } catch (error) {
      await ctx.reply('❌ 封禁失败，请检查机器人权限。');
    }
  });

  bot.command('kick', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const targetUser = ctx.message?.reply_to_message?.from;
    if (!targetUser) {
      await ctx.reply('❌ 请回复要踢出的用户消息。');
      return;
    }

    try {
      await ctx.banChatMember(targetUser.id);
      await ctx.unbanChatMember(targetUser.id);  // Unban immediately to allow rejoin
      await ctx.reply(`👢 用户 ${targetUser.first_name} 已被踢出。`);

      await logAction(env, ctx.chat.id, ctx.from!.id, 'kick', `Kicked user ${targetUser.id}`);
    } catch (error) {
      await ctx.reply('❌ 踢出失败，请检查机器人权限。');
    }
  });

  bot.command('mute', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const targetUser = ctx.message?.reply_to_message?.from;
    if (!targetUser) {
      await ctx.reply('❌ 请回复要禁言的用户消息。');
      return;
    }

    // Parse duration from command args
    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const duration = parseDuration(args[0]);

    try {
      const untilDate = Math.floor(Date.now() / 1000) + duration;
      await ctx.restrictChatMember(targetUser.id, {
        can_send_messages: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      }, {
        until_date: untilDate,
      });

      const durationText = formatDuration(duration);
      await ctx.reply(`🔇 用户 ${targetUser.first_name} 已被禁言 ${durationText}。`);

      await logAction(env, ctx.chat.id, ctx.from!.id, 'mute', `Muted user ${targetUser.id} for ${durationText}`);
    } catch (error) {
      await ctx.reply('❌ 禁言失败，请检查机器人权限。');
    }
  });

  bot.command('warn', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const targetUser = ctx.message?.reply_to_message?.from;
    if (!targetUser) {
      await ctx.reply('❌ 请回复要警告的用户消息。');
      return;
    }

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const reason = args.join(' ') || 'No reason provided';
    const groupId = ctx.chat.id;

    // Add warning to database
    await env.DB.prepare(`
      INSERT INTO warnings (group_id, user_id, admin_id, reason) VALUES (?, ?, ?, ?)
    `).bind(groupId, targetUser.id, ctx.from!.id, reason).run();

    // Get warning count
    const result = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM warnings WHERE group_id = ? AND user_id = ?
    `).bind(groupId, targetUser.id).first<{ count: number }>();

    const warnCount = Number(result?.count) || 1;
    const maxWarnings = 3;

    await ctx.reply(
      `⚠️ <b>警告 #${warnCount}</b>\n` +
      `用户: ${targetUser.first_name}\n` +
      `原因: ${reason}\n\n` +
      (warnCount >= maxWarnings ? `🚫 已达到最大警告次数，自动封禁。` : `剩余次数: ${maxWarnings - warnCount}`),
      { parse_mode: 'HTML' }
    );

    // Auto-ban if max warnings reached
    if (warnCount >= maxWarnings) {
      try {
        await ctx.banChatMember(targetUser.id);
        await ctx.reply(`🚫 用户 ${targetUser.first_name} 因达到最大警告次数已被封禁。`);
      } catch (error) {
        // Ignore ban errors
      }
    }

    await logAction(env, groupId, ctx.from!.id, 'warn', `Warned user ${targetUser.id}: ${reason}`);
  });

  // === Announcement Commands ===

  bot.command('announce', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const content = args.join(' ');

    if (!content && !ctx.message?.reply_to_message) {
      await ctx.reply('❌ 请提供公告内容或回复要公告的消息。');
      return;
    }

    const announceContent = content || ctx.message?.reply_to_message?.text || '';

    try {
      const msg = await ctx.reply(`📢 <b>公告</b>\n\n${announceContent}`, { parse_mode: 'HTML' });

      // Pin the announcement
      try {
        await ctx.pinChatMessage(msg.message_id);
      } catch (e) {
        // Ignore pin errors
      }

      // Save to database
      await env.DB.prepare(`
        INSERT INTO announcements (group_id, content, created_by, is_pinned) VALUES (?, ?, ?, 1)
      `).bind(ctx.chat.id, announceContent, ctx.from!.id).run();

    } catch (error) {
      await ctx.reply('❌ 发送公告失败。');
    }
  });

  bot.command('scheduledannounce', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    // Format: /scheduledannounce 2024-12-25 10:00 公告内容
    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length < 3) {
      await ctx.reply(
        '❌ 格式错误。\n\n' +
        '用法: <code>/scheduledannounce YYYY-MM-DD HH:MM 公告内容</code>\n' +
        '示例: <code>/scheduledannounce 2024-12-25 10:00 节日快乐！</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const dateStr = `${args[0]} ${args[1]}`;
    const content = args.slice(2).join(' ');
    const scheduledTime = new Date(dateStr);

    if (isNaN(scheduledTime.getTime())) {
      await ctx.reply('❌ 日期格式无效。请使用 YYYY-MM-DD HH:MM 格式。');
      return;
    }

    // Save scheduled announcement
    await env.DB.prepare(`
      INSERT INTO scheduled_announcements (group_id, content, scheduled_time, created_by)
      VALUES (?, ?, ?, ?)
    `).bind(ctx.chat.id, content, scheduledTime.toISOString(), ctx.from!.id).run();

    await ctx.reply(
      `⏰ 定时公告已设置\n` +
      `时间: ${dateStr}\n` +
      `内容: ${content}`,
      { parse_mode: 'HTML' }
    );
  });

  // === Promotion Commands ===

  bot.command('invitelink', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const subCommand = args[0] || 'create';

    const groupId = ctx.chat.id;

    if (subCommand === 'create') {
      try {
        const expireDate = Math.floor(Date.now() / 1000) + 86400; // 24 hours
        const result = await ctx.api.createChatInviteLink(groupId, {
          member_limit: 1,
          creates_join_request: false,
        });

        const inviteLink = result.invite_link;

        // Save to database
        await env.DB.prepare(`
          INSERT INTO invite_links (group_id, link, name, created_by) VALUES (?, ?, ?, ?)
        `).bind(groupId, inviteLink, `Link-${Date.now()}`, ctx.from!.id).run();

        await ctx.reply(
          `🔗 邀请链接已创建\n\n` +
          `<code>${inviteLink}</code>\n\n` +
          `使用 /invitelink stats 查看统计`,
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        await ctx.reply('❌ 创建邀请链接失败。');
      }
    } else if (subCommand === 'stats') {
      // Get invite link statistics
      const { results } = await env.DB.prepare(`
        SELECT * FROM invite_links WHERE group_id = ? AND is_active = 1
      `).bind(groupId).all();

      if (!results || results.length === 0) {
        await ctx.reply('📊 暂无邀请链接。');
        return;
      }

      let statsText = '📊 <b>邀请链接统计</b>\n\n';
      for (const link of results) {
        statsText += `🔗 ${link.name}: ${link.current_uses} 次使用\n`;
      }

      await ctx.reply(statsText, { parse_mode: 'HTML' });
    }
  });

  // === Welcome/Rules Commands ===

  bot.command('setwelcome', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const welcomeMessage = args.join(' ');

    if (!welcomeMessage) {
      await ctx.reply('❌ 请提供欢迎消息内容。');
      return;
    }

    await env.DB.prepare(`
      UPDATE groups SET welcome_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(welcomeMessage, ctx.chat.id).run();

    await ctx.reply('✅ 欢迎消息已设置。');
  });

  bot.command('setrules', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const rules = args.join(' ');

    if (!rules) {
      await ctx.reply('❌ 请提供规则内容。');
      return;
    }

    await env.DB.prepare(`
      UPDATE groups SET rules = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(rules, ctx.chat.id).run();

    await ctx.reply('✅ 群组规则已设置。');
  });

  bot.command('rules', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;

    const group = await env.DB.prepare(`
      SELECT rules FROM groups WHERE id = ?
    `).bind(ctx.chat.id).first<{ rules: string | null }>();

    if (group?.rules) {
      await ctx.reply(`📜 <b>群组规则</b>\n\n${group.rules}`, { parse_mode: 'HTML' });
    } else {
      // Fall back to global config set via dashboard
      let globalRules = '';
      try {
        const stored = await env.CACHE.get('bot_config');
        if (stored) {
          globalRules = JSON.parse(stored).group_rules || '';
        }
      } catch (e) {
        console.error('Failed to read global rules:', e);
      }

      if (globalRules) {
        await ctx.reply(`📜 <b>群组规则</b>\n\n${globalRules}`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply('📜 暂无群组规则。');
      }
    }
  });

  // === Notes Commands ===

  bot.command('note', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length < 2) {
      await ctx.reply(
        '❌ 格式错误。\n\n' +
        '用法: <code>/note 关键词 内容</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const keyword = args[0].toLowerCase();
    const content = args.slice(1).join(' ');

    await env.DB.prepare(`
      INSERT INTO notes (group_id, keyword, content, created_by) VALUES (?, ?, ?, ?)
    `).bind(ctx.chat.id, keyword, content, ctx.from!.id).run();

    await ctx.reply(`✅ 笔记 <b>#${keyword}</b> 已保存。`, { parse_mode: 'HTML' });
  });

  bot.command('notes', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;

    const { results } = await env.DB.prepare(`
      SELECT keyword FROM notes WHERE group_id = ? ORDER BY keyword
    `).bind(ctx.chat.id).all();

    if (!results || results.length === 0) {
      await ctx.reply('📝 暂无笔记。');
      return;
    }

    const keywords = results.map((r: any) => `#${r.keyword}`).join(', ');
    await ctx.reply(`📝 <b>笔记列表</b>\n\n${keywords}`, { parse_mode: 'HTML' });
  });

  bot.command('delnote', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const keyword = args[0]?.toLowerCase();

    if (!keyword) {
      await ctx.reply('❌ 请提供要删除的笔记关键词。');
      return;
    }

    await env.DB.prepare(`
      DELETE FROM notes WHERE group_id = ? AND keyword = ?
    `).bind(ctx.chat.id, keyword).run();

    await ctx.reply(`✅ 笔记 <b>#${keyword}</b> 已删除。`, { parse_mode: 'HTML' });
  });

  // === Filter Commands ===

  bot.command('filter', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length < 2) {
      await ctx.reply(
        '❌ 格式错误。\n\n' +
        '用法: <code>/filter 关键词 回复内容</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const keyword = args[0].toLowerCase();
    const response = args.slice(1).join(' ');

    await env.DB.prepare(`
      INSERT INTO filters (group_id, keyword, response, created_by) VALUES (?, ?, ?, ?)
    `).bind(ctx.chat.id, keyword, response, ctx.from!.id).run();

    await ctx.reply(`✅ 过滤器 <b>#${keyword}</b> 已设置。`, { parse_mode: 'HTML' });
  });

  bot.command('filters', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;

    const { results } = await env.DB.prepare(`
      SELECT keyword FROM filters WHERE group_id = ? ORDER BY keyword
    `).bind(ctx.chat.id).all();

    if (!results || results.length === 0) {
      await ctx.reply('🔍 暂无过滤器。');
      return;
    }

    const keywords = results.map((r: any) => `#${r.keyword}`).join(', ');
    await ctx.reply(`🔍 <b>过滤器列表</b>\n\n${keywords}`, { parse_mode: 'HTML' });
  });

  bot.command('stop', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const keyword = args[0]?.toLowerCase();

    if (!keyword) {
      await ctx.reply('❌ 请提供要删除的过滤器关键词。');
      return;
    }

    await env.DB.prepare(`
      DELETE FROM filters WHERE group_id = ? AND keyword = ?
    `).bind(ctx.chat.id, keyword).run();

    await ctx.reply(`✅ 过滤器 <b>#${keyword}</b> 已删除。`, { parse_mode: 'HTML' });
  });

  // === Lock Commands ===

  bot.command('lock', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const lockType = args[0]?.toLowerCase();

    if (!lockType) {
      await ctx.reply(
        '❌ 请提供要锁定的类型。\n\n' +
        '可用类型: sticker, gif, link, media, all',
        { parse_mode: 'HTML' }
      );
      return;
    }

    await env.DB.prepare(`
      INSERT OR REPLACE INTO group_locks (group_id, lock_type, is_locked) VALUES (?, ?, 1)
    `).bind(ctx.chat.id, lockType).run();

    await ctx.reply(`🔒 <b>${lockType}</b> 已锁定。`, { parse_mode: 'HTML' });
  });

  bot.command('unlock', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    if (!await checkAdminPermission(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const lockType = args[0]?.toLowerCase();

    if (!lockType) {
      await ctx.reply('❌ 请提供要解锁的类型。');
      return;
    }

    await env.DB.prepare(`
      DELETE FROM group_locks WHERE group_id = ? AND lock_type = ?
    `).bind(ctx.chat.id, lockType).run();

    await ctx.reply(`🔓 <b>${lockType}</b> 已解锁。`, { parse_mode: 'HTML' });
  });

  // === Broadcast (Bot Admin Only) ===

  bot.command('broadcast', async (ctx: Context) => {
    if (!ctx.from) return;

    const isBotAdmin = (env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean).includes(ctx.from.id);
    if (!isBotAdmin) {
      await ctx.reply('❌ 只有机器人管理员可以使用此命令。');
      return;
    }

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const message = args.join(' ');

    if (!message) {
      await ctx.reply('❌ 请提供广播内容。');
      return;
    }

    // Get all groups
    const { results } = await env.DB.prepare(`
      SELECT id FROM groups
    `).all();

    if (!results || results.length === 0) {
      await ctx.reply('📭 暂无群组。');
      return;
    }

    let sent = 0;
    let failed = 0;

    for (const group of results) {
      try {
        await ctx.api.sendMessage(
          (group as any).id as number,
          `📢 <b>全局广播</b>\n\n${message}`,
          { parse_mode: 'HTML' }
        );
        sent++;
      } catch (error) {
        failed++;
      }
    }

    await ctx.reply(
      `📢 广播完成\n\n` +
      `✅ 成功: ${sent}\n` +
      `❌ 失败: ${failed}`,
      { parse_mode: 'HTML' }
    );
  });

  // === Info Command ===

  bot.command('info', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;

    const targetUser = ctx.message?.reply_to_message?.from || ctx.from;
    if (!targetUser) return;

    const groupId = ctx.chat.id;

    // Get user warnings
    const warningResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM warnings WHERE group_id = ? AND user_id = ?
    `).bind(groupId, targetUser.id).first<{ count: number }>();

    // Get user reputation
    const userResult = await env.DB.prepare(`
      SELECT reputation FROM users WHERE id = ?
    `).bind(targetUser.id).first<{ reputation: number }>();

    const username = targetUser.username ? `@${targetUser.username}` : 'N/A';

    await ctx.reply(
      `👤 <b>用户信息</b>\n\n` +
      `名称: ${targetUser.first_name} ${targetUser.last_name || ''}\n` +
      `用户名: ${username}\n` +
      `ID: <code>${targetUser.id}</code>\n` +
      `⚠️ 警告: ${warningResult?.count || 0}/3\n` +
      `⭐ 声望: ${userResult?.reputation || 0}`,
      { parse_mode: 'HTML' }
    );
  });
}

/**
 * Check if user has admin permission
 */
async function checkAdminPermission(ctx: Context, env: Env): Promise<boolean> {
  if (!ctx.from || !ctx.chat || ctx.chat.type === 'private') return false;

  const adminIds = (env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
  const isBotAdmin = adminIds.includes(ctx.from.id);
  const isGroupAdm = await isGroupAdmin(ctx, ctx.from.id);

  if (!isBotAdmin && !isGroupAdm) {
    await ctx.reply('❌ 你没有权限使用此命令。');
    return false;
  }

  return true;
}

/**
 * Log an action to the database
 */
async function logAction(env: Env, groupId: number, userId: number, action: string, details: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO action_logs (group_id, user_id, action, details) VALUES (?, ?, ?, ?)
  `).bind(groupId, userId, action, details).run();
}

/**
 * Parse duration string to seconds
 */
function parseDuration(durationStr?: string): number {
  if (!durationStr) return 3600; // Default 1 hour

  const match = durationStr.match(/^(\d+)(m|h|d)?$/i);
  if (!match) return 3600;

  const value = parseInt(match[1]);
  const unit = (match[2] || 'm').toLowerCase();

  switch (unit) {
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return value * 60;
  }
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
  return `${Math.floor(seconds / 86400)}天`;
}

/**
 * Get help text
 */
function getHelpText(): string {
  return `📖 <b>机器人命令列表</b>\n\n` +
    `<b>基础命令:</b>\n` +
    `/start - 启动机器人\n` +
    `/help - 显示帮助\n` +
    `/admin - 管理面板\n` +
    `/stats - 群组统计\n` +
    `/info - 用户信息\n\n` +

    `<b>审核命令:</b>\n` +
    `/ban - 封禁用户\n` +
    `/kick - 踢出用户\n` +
    `/mute - 禁言用户\n` +
    `/warn - 警告用户\n\n` +

    `<b>公告命令:</b>\n` +
    `/announce - 发送公告\n` +
    `/scheduledannounce - 定时公告\n\n` +

    `<b>引流命令:</b>\n` +
    `/invitelink - 邀请链接管理\n\n` +

    `<b>笔记命令:</b>\n` +
    `/note - 保存笔记\n` +
    `/notes - 笔记列表\n` +
    `/delnote - 删除笔记\n\n` +

    `<b>过滤器命令:</b>\n` +
    `/filter - 设置自动回复\n` +
    `/filters - 过滤器列表\n` +
    `/stop - 删除过滤器\n\n` +

    `<b>设置命令:</b>\n` +
    `/setwelcome - 设置欢迎消息\n` +
    `/setrules - 设置群组规则\n` +
    `/rules - 查看规则\n` +
    `/lock - 锁定内容类型\n` +
    `/unlock - 解锁内容类型\n\n` +

    `<b>管理员命令:</b>\n` +
    `/broadcast - 全局广播`;
}
