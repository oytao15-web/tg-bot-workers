/**
 * Command handlers for the Telegram Bot
 * Plan A: group management commands are private-chat only,
 * group chats only expose basic commands (silently ignore admin commands)
 */

import { Bot, Context, InlineKeyboard } from 'grammy';
import { Env } from './types';

const SESSION_PREFIX = 'admin_session:';

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

  // === Basic Commands (group + private) ===

  bot.command('start', async (ctx: Context) => {
    const chatType = ctx.chat?.type;

    if (chatType === 'private') {
      await ctx.reply(
        `👋 你好！我是群组管理机器人。\n\n` +
        `将我添加到你的群组，即可使用以下功能：\n\n` +
        `🛡️ 审核管理 - 踢除、禁言、警告\n` +
        `📝 笔记系统 - 保存和检索消息\n` +
        `🔍 自动回复 - 关键词触发回复\n` +
        `📢 公告管理 - 发送群组公告\n` +
        `📊 引流追踪 - 邀请链接统计\n\n` +
        `管理员请私聊使用 /admin 管理所有群组`,
        { parse_mode: 'HTML' }
      );
    } else {
      const groupId = ctx.chat!.id;
      await env.DB.prepare(`
        INSERT OR IGNORE INTO groups (id, title) VALUES (?, ?)
      `).bind(groupId, ctx.chat!.title || 'Unknown').run();
      await ctx.reply('👋 机器人已启动！使用 /help 查看可用命令。');
    }
  });

  bot.command('help', async (ctx: Context) => {
    const helpText = getHelpText(ctx.chat?.type === 'private');
    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });

  bot.command('rules', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;

    const group = await env.DB.prepare(`
      SELECT rules FROM groups WHERE id = ?
    `).bind(ctx.chat.id).first<{ rules: string | null }>();

    if (group?.rules) {
      await ctx.reply(`📜 <b>群组规则</b>\n\n${group.rules}`, { parse_mode: 'HTML' });
    } else {
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

  bot.command('info', async (ctx: Context) => {
    if (!ctx.chat || ctx.chat.type === 'private') return;

    const targetUser = ctx.message?.reply_to_message?.from || ctx.from;
    if (!targetUser) return;

    const groupId = ctx.chat.id;

    const warningResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM warnings WHERE group_id = ? AND user_id = ?
    `).bind(groupId, targetUser.id).first<{ count: number }>();

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

  // === Private Admin Commands (Plan A) ===

  bot.command('admin', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;

    const { results } = await env.DB.prepare(`
      SELECT id, title FROM groups ORDER BY title
    `).all();

    if (!results || results.length === 0) {
      await ctx.reply('📭 暂无已接入的群组。\n\n请先把机器人添加到群组并设为管理员，机器人会自动记录。');
      return;
    }

    const kb = new InlineKeyboard();
    for (const group of results as any[]) {
      kb.text(`📌 ${group.title}`, `admin_select:${group.id}`).row();
    }

    await ctx.reply('📋 <b>选择要管理的群组</b>', { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.command('groups', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;

    const { results } = await env.DB.prepare(`
      SELECT id, title FROM groups ORDER BY title
    `).all();

    if (!results || results.length === 0) {
      await ctx.reply('📭 暂无已接入的群组。');
      return;
    }

    const text = (results as any[]).map((g, i) => `${i + 1}. ${g.title}  <code>${g.id}</code>`).join('\n');
    await ctx.reply(`📋 <b>已接入群组</b>\n\n${text}\n\n使用 /select 群ID 选择要管理的群组`, { parse_mode: 'HTML' });
  });

  bot.command('select', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const groupId = Number(args[0]);

    if (!groupId || isNaN(groupId)) {
      await ctx.reply('❌ 用法: <code>/select 群ID</code>\n\n使用 /groups 查看群ID', { parse_mode: 'HTML' });
      return;
    }

    const group = await env.DB.prepare(`
      SELECT id, title FROM groups WHERE id = ?
    `).bind(groupId).first<{ id: number; title: string }>();

    if (!group) {
      await ctx.reply('❌ 群组不存在，请用 /groups 查看已接入的群。');
      return;
    }

    await setActiveGroup(env, ctx.from!.id, groupId);
    await ctx.reply(`✅ 已选择群组: <b>${group.title}</b>\n\n` + getAdminMenuText(), { parse_mode: 'HTML' });
  });

  bot.command('stats', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;
    const group = await getGroupInfo(env, groupId);

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
      `📊 <b>${group?.title || groupId}</b> 群组统计\n\n` +
      `👥 成员数量: ${memberCount?.count || 0}\n` +
      `⚠️ 警告总数: ${warningCount?.count || 0}\n` +
      `📝 笔记数量: ${noteCount?.count || 0}`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('ban', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const targetUserId = Number(args[0]);

    if (!targetUserId) {
      await ctx.reply('❌ 用法: <code>/ban 用户ID</code>', { parse_mode: 'HTML' });
      return;
    }

    try {
      await ctx.api.banChatMember(groupId, targetUserId);
      await ctx.reply(`🚫 用户 <code>${targetUserId}</code> 已被封禁。`);
      await logAction(env, groupId, ctx.from!.id, 'ban', `Banned user ${targetUserId}`);
    } catch (error) {
      await ctx.reply('❌ 封禁失败，请确认机器人是该群管理员。');
    }
  });

  bot.command('kick', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const targetUserId = Number(args[0]);

    if (!targetUserId) {
      await ctx.reply('❌ 用法: <code>/kick 用户ID</code>', { parse_mode: 'HTML' });
      return;
    }

    try {
      await ctx.api.banChatMember(groupId, targetUserId);
      await ctx.api.unbanChatMember(groupId, targetUserId);
      await ctx.reply(`👢 用户 <code>${targetUserId}</code> 已被踢出。`);
      await logAction(env, groupId, ctx.from!.id, 'kick', `Kicked user ${targetUserId}`);
    } catch (error) {
      await ctx.reply('❌ 踢出失败，请确认机器人是该群管理员。');
    }
  });

  bot.command('mute', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const targetUserId = Number(args[0]);
    const duration = parseDuration(args[1]);

    if (!targetUserId) {
      await ctx.reply('❌ 用法: <code>/mute 用户ID [时长]</code>\n\n时长格式: 10m / 1h / 2d，默认 1h', { parse_mode: 'HTML' });
      return;
    }

    try {
      const untilDate = Math.floor(Date.now() / 1000) + duration;
      await ctx.api.restrictChatMember(groupId, targetUserId, {
        can_send_messages: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      }, { until_date: untilDate });

      const durationText = formatDuration(duration);
      await ctx.reply(`🔇 用户 <code>${targetUserId}</code> 已被禁言 ${durationText}。`);
      await logAction(env, groupId, ctx.from!.id, 'mute', `Muted user ${targetUserId} for ${durationText}`);
    } catch (error) {
      await ctx.reply('❌ 禁言失败，请确认机器人是该群管理员。');
    }
  });

  bot.command('warn', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const targetUserId = Number(args[0]);
    const reason = args.slice(1).join(' ') || 'No reason provided';

    if (!targetUserId) {
      await ctx.reply('❌ 用法: <code>/warn 用户ID [原因]</code>', { parse_mode: 'HTML' });
      return;
    }

    await env.DB.prepare(`
      INSERT INTO warnings (group_id, user_id, admin_id, reason) VALUES (?, ?, ?, ?)
    `).bind(groupId, targetUserId, ctx.from!.id, reason).run();

    const result = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM warnings WHERE group_id = ? AND user_id = ?
    `).bind(groupId, targetUserId).first<{ count: number }>();

    const warnCount = Number(result?.count) || 1;
    const maxWarnings = 3;

    await ctx.reply(
      `⚠️ <b>警告 #${warnCount}</b>\n` +
      `用户: <code>${targetUserId}</code>\n` +
      `原因: ${reason}\n\n` +
      (warnCount >= maxWarnings ? `🚫 已达到最大警告次数，自动封禁。` : `剩余次数: ${maxWarnings - warnCount}`),
      { parse_mode: 'HTML' }
    );

    if (warnCount >= maxWarnings) {
      try {
        await ctx.api.banChatMember(groupId, targetUserId);
        await ctx.reply(`🚫 用户 <code>${targetUserId}</code> 因达到最大警告次数已被封禁。`);
      } catch (error) {
        // Ignore ban errors
      }
    }

    await logAction(env, groupId, ctx.from!.id, 'warn', `Warned user ${targetUserId}: ${reason}`);
  });

  bot.command('announce', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const content = args.join(' ');

    if (!content) {
      await ctx.reply('❌ 用法: <code>/announce 公告内容</code>', { parse_mode: 'HTML' });
      return;
    }

    try {
      const msg = await ctx.api.sendMessage(groupId, `📢 <b>公告</b>\n\n${content}`, { parse_mode: 'HTML' });

      try {
        await ctx.api.pinChatMessage(groupId, msg.message_id);
      } catch (e) {
        // Ignore pin errors
      }

      await env.DB.prepare(`
        INSERT INTO announcements (group_id, content, created_by, is_pinned) VALUES (?, ?, ?, 1)
      `).bind(groupId, content, ctx.from!.id).run();

      await ctx.reply('✅ 公告已发送并置顶。');
    } catch (error) {
      await ctx.reply('❌ 发送公告失败，请确认机器人是该群管理员。');
    }
  });

  bot.command('scheduledannounce', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length < 3) {
      await ctx.reply(
        '❌ 用法: <code>/scheduledannounce YYYY-MM-DD HH:MM 公告内容</code>\n\n' +
        '示例: <code>/scheduledannounce 2026-12-25 10:00 节日快乐！</code>',
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

    await env.DB.prepare(`
      INSERT INTO scheduled_announcements (group_id, content, scheduled_time, created_by)
      VALUES (?, ?, ?, ?)
    `).bind(groupId, content, scheduledTime.toISOString(), ctx.from!.id).run();

    await ctx.reply(
      `⏰ 定时公告已设置\n` +
      `时间: ${dateStr}\n` +
      `内容: ${content}`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('invitelink', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const subCommand = args[0] || 'create';

    if (subCommand === 'create') {
      try {
        const result = await ctx.api.createChatInviteLink(groupId, {
          member_limit: 1,
          creates_join_request: false,
        });

        const inviteLink = result.invite_link;

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
        await ctx.reply('❌ 创建邀请链接失败，请确认机器人是该群管理员。');
      }
    } else if (subCommand === 'stats') {
      const { results } = await env.DB.prepare(`
        SELECT * FROM invite_links WHERE group_id = ? AND is_active = 1
      `).bind(groupId).all();

      if (!results || results.length === 0) {
        await ctx.reply('📊 暂无邀请链接。');
        return;
      }

      let statsText = '📊 <b>邀请链接统计</b>\n\n';
      for (const link of results as any[]) {
        statsText += `🔗 ${link.name}: ${link.current_uses} 次使用\n`;
      }

      await ctx.reply(statsText, { parse_mode: 'HTML' });
    }
  });

  bot.command('setwelcome', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const welcomeMessage = args.join(' ');

    if (!welcomeMessage) {
      await ctx.reply('❌ 用法: <code>/setwelcome 欢迎消息内容</code>\n\n可用变量: {first_name} {group_name}', { parse_mode: 'HTML' });
      return;
    }

    await env.DB.prepare(`
      UPDATE groups SET welcome_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(welcomeMessage, groupId).run();

    await ctx.reply('✅ 欢迎消息已设置。');
  });

  bot.command('setrules', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const rules = args.join(' ');

    if (!rules) {
      await ctx.reply('❌ 用法: <code>/setrules 规则内容</code>', { parse_mode: 'HTML' });
      return;
    }

    await env.DB.prepare(`
      UPDATE groups SET rules = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(rules, groupId).run();

    await ctx.reply('✅ 群组规则已设置。');
  });

  bot.command('note', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length < 2) {
      await ctx.reply('❌ 用法: <code>/note 关键词 内容</code>', { parse_mode: 'HTML' });
      return;
    }

    const keyword = args[0].toLowerCase();
    const content = args.slice(1).join(' ');

    await env.DB.prepare(`
      INSERT INTO notes (group_id, keyword, content, created_by) VALUES (?, ?, ?, ?)
    `).bind(groupId, keyword, content, ctx.from!.id).run();

    await ctx.reply(`✅ 笔记 <b>#${keyword}</b> 已保存。`, { parse_mode: 'HTML' });
  });

  bot.command('delnote', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const keyword = args[0]?.toLowerCase();

    if (!keyword) {
      await ctx.reply('❌ 用法: <code>/delnote 关键词</code>', { parse_mode: 'HTML' });
      return;
    }

    await env.DB.prepare(`
      DELETE FROM notes WHERE group_id = ? AND keyword = ?
    `).bind(groupId, keyword).run();

    await ctx.reply(`✅ 笔记 <b>#${keyword}</b> 已删除。`, { parse_mode: 'HTML' });
  });

  bot.command('filter', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length < 2) {
      await ctx.reply('❌ 用法: <code>/filter 关键词 回复内容</code>', { parse_mode: 'HTML' });
      return;
    }

    const keyword = args[0].toLowerCase();
    const response = args.slice(1).join(' ');

    await env.DB.prepare(`
      INSERT INTO filters (group_id, keyword, response, created_by) VALUES (?, ?, ?, ?)
    `).bind(groupId, keyword, response, ctx.from!.id).run();

    await ctx.reply(`✅ 过滤器 <b>#${keyword}</b> 已设置。`, { parse_mode: 'HTML' });
  });

  bot.command('stop', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const keyword = args[0]?.toLowerCase();

    if (!keyword) {
      await ctx.reply('❌ 用法: <code>/stop 关键词</code>', { parse_mode: 'HTML' });
      return;
    }

    await env.DB.prepare(`
      DELETE FROM filters WHERE group_id = ? AND keyword = ?
    `).bind(groupId, keyword).run();

    await ctx.reply(`✅ 过滤器 <b>#${keyword}</b> 已删除。`, { parse_mode: 'HTML' });
  });

  bot.command('lock', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const lockType = args[0]?.toLowerCase();

    if (!lockType) {
      await ctx.reply(
        '❌ 用法: <code>/lock 类型</code>\n\n' +
        '可用类型: sticker, gif, link, media, all',
        { parse_mode: 'HTML' }
      );
      return;
    }

    await env.DB.prepare(`
      INSERT OR REPLACE INTO group_locks (group_id, lock_type, is_locked) VALUES (?, ?, 1)
    `).bind(groupId, lockType).run();

    await ctx.reply(`🔒 <b>${lockType}</b> 已锁定。`, { parse_mode: 'HTML' });
  });

  bot.command('unlock', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;
    const groupId = await requireGroup(ctx, env);
    if (!groupId) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const lockType = args[0]?.toLowerCase();

    if (!lockType) {
      await ctx.reply('❌ 用法: <code>/unlock 类型</code>', { parse_mode: 'HTML' });
      return;
    }

    await env.DB.prepare(`
      DELETE FROM group_locks WHERE group_id = ? AND lock_type = ?
    `).bind(groupId, lockType).run();

    await ctx.reply(`🔓 <b>${lockType}</b> 已解锁。`, { parse_mode: 'HTML' });
  });

  bot.command('broadcast', async (ctx: Context) => {
    if (ctx.chat?.type !== 'private') return;
    if (!isBotAdmin(ctx, env)) return;

    const args = ctx.message?.text?.split(' ').slice(1) || [];
    const message = args.join(' ');

    if (!message) {
      await ctx.reply('❌ 用法: <code>/broadcast 广播内容</code>', { parse_mode: 'HTML' });
      return;
    }

    const { results } = await env.DB.prepare(`
      SELECT id FROM groups
    `).all();

    if (!results || results.length === 0) {
      await ctx.reply('📭 暂无群组。');
      return;
    }

    let sent = 0;
    let failed = 0;

    for (const group of results as any[]) {
      try {
        await ctx.api.sendMessage(
          group.id as number,
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

  // === Callback Query Handler (inline keyboard) ===

  bot.on('callback_query:data', async (ctx: Context) => {
    const data = ctx.callbackQuery?.data || '';
    const userId = ctx.from?.id;
    if (!userId || !isBotAdmin(ctx, env)) return;

    if (data.startsWith('admin_select:')) {
      const groupId = Number(data.split(':')[1]);
      if (!groupId) return;

      const group = await env.DB.prepare(`
        SELECT id, title FROM groups WHERE id = ?
      `).bind(groupId).first<{ id: number; title: string }>();

      await setActiveGroup(env, userId, groupId);
      await ctx.answerCallbackQuery({ text: `已选择: ${group?.title || groupId}` });
      await ctx.reply(
        `✅ 已选择群组: <b>${group?.title || groupId}</b>\n\n` + getAdminMenuText(),
        { parse_mode: 'HTML' }
      );
    }
  });
}

// === Helpers ===

function isBotAdmin(ctx: Context, env: Env): boolean {
  const userId = ctx.from?.id;
  if (!userId) return false;
  return (env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean).includes(userId);
}

async function getActiveGroup(env: Env, userId: number): Promise<number | null> {
  try {
    const stored = await env.CACHE.get(`${SESSION_PREFIX}${userId}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.activeGroupId || null;
    }
  } catch (e) {
    console.error('Failed to read session:', e);
  }
  return null;
}

async function setActiveGroup(env: Env, userId: number, groupId: number): Promise<void> {
  try {
    await env.CACHE.put(`${SESSION_PREFIX}${userId}`, JSON.stringify({ activeGroupId: groupId }));
  } catch (e) {
    console.error('Failed to save session:', e);
  }
}

async function requireGroup(ctx: Context, env: Env): Promise<number | null> {
  const userId = ctx.from?.id;
  if (!userId) return null;

  const groupId = await getActiveGroup(env, userId);
  if (!groupId) {
    await ctx.reply('⚠️ 请先使用 /admin 选择要管理的群组。');
    return null;
  }
  return groupId;
}

async function getGroupInfo(env: Env, groupId: number): Promise<{ id: number; title: string } | null> {
  try {
    return await env.DB.prepare(`
      SELECT id, title FROM groups WHERE id = ?
    `).bind(groupId).first<{ id: number; title: string }>();
  } catch {
    return null;
  }
}

function getAdminMenuText(): string {
  return `📊 /stats - 群组统计\n` +
    `📢 /announce 内容 - 发送公告\n` +
    `⏰ /scheduledannounce 时间 内容 - 定时公告\n` +
    `🔗 /invitelink - 创建邀请链接\n` +
    `🚫 /ban 用户ID - 封禁\n` +
    `👢 /kick 用户ID - 踢出\n` +
    `🔇 /mute 用户ID 时长 - 禁言\n` +
    `⚠️ /warn 用户ID 原因 - 警告\n` +
    `📝 /note 关键词 内容 - 保存笔记\n` +
    `🔍 /filter 关键词 回复 - 自动回复\n` +
    `⚙️ /setwelcome 内容 - 欢迎消息\n` +
    `📜 /setrules 内容 - 群规则\n` +
    `🔒 /lock 类型 - 锁定内容\n` +
    `📋 /broadcast 内容 - 全局广播`;
}

async function logAction(env: Env, groupId: number, userId: number, action: string, details: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO action_logs (group_id, user_id, action, details) VALUES (?, ?, ?, ?)
  `).bind(groupId, userId, action, details).run();
}

function parseDuration(durationStr?: string): number {
  if (!durationStr) return 3600;

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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
  return `${Math.floor(seconds / 86400)}天`;
}

function getHelpText(isPrivate: boolean): string {
  if (isPrivate) {
    return `📖 <b>私聊管理命令</b>\n\n` +
      `<b>群组管理:</b>\n` +
      `/admin - 选择并管理群组\n` +
      `/groups - 列出所有群组\n` +
      `/select 群ID - 选择群组\n` +
      `/stats - 群组统计\n\n` +

      `<b>审核命令:</b>\n` +
      `/ban 用户ID - 封禁\n` +
      `/kick 用户ID - 踢出\n` +
      `/mute 用户ID 时长 - 禁言\n` +
      `/warn 用户ID 原因 - 警告\n\n` +

      `<b>公告命令:</b>\n` +
      `/announce 内容 - 发送公告\n` +
      `/scheduledannounce 时间 内容 - 定时公告\n\n` +

      `<b>引流命令:</b>\n` +
      `/invitelink - 邀请链接管理\n\n` +

      `<b>内容管理:</b>\n` +
      `/note 关键词 内容 - 保存笔记\n` +
      `/delnote 关键词 - 删除笔记\n` +
      `/filter 关键词 回复 - 自动回复\n` +
      `/stop 关键词 - 删除过滤器\n\n` +

      `<b>设置命令:</b>\n` +
      `/setwelcome 内容 - 欢迎消息\n` +
      `/setrules 内容 - 群规则\n` +
      `/lock 类型 - 锁定内容\n` +
      `/unlock 类型 - 解锁内容\n\n` +

      `<b>管理员命令:</b>\n` +
      `/broadcast 内容 - 全局广播`;
  }

  return `📖 <b>机器人命令列表</b>\n\n` +
    `<b>基础命令:</b>\n` +
    `/start - 启动机器人\n` +
    `/help - 显示帮助\n` +
    `/rules - 查看群规则\n` +
    `/notes - 笔记列表\n` +
    `/filters - 过滤器列表\n` +
    `/info - 用户信息\n\n` +
    `管理员请私聊机器人使用 /admin 管理群组`;
}
