/**
 * Message handlers for the Telegram Bot
 * Handles non-command events like new members, filters, flood control, join approval
 */

import { Bot, Context, InlineKeyboard } from 'grammy';
import { Env } from './types';

// Read global config from KV (set via dashboard)
async function getGlobalConfig(env: Env): Promise<any> {
  try {
    const stored = await env.CACHE.get('bot_config');
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to read global config:', e);
  }
  return {};
}

// Check if user is admin in the group
async function isAdmin(ctx: Context, env: Env): Promise<boolean> {
  if (!ctx.from) return false;
  const adminIds = (env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
  if (adminIds.includes(ctx.from.id)) return true;
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    if (member.status === 'administrator' || member.status === 'creator') return true;
  } catch (e) { /* ignore */ }
  return false;
}

export function setupHandlers(bot: Bot, env: Env): void {
  
  // === New Member Handler (Welcome + Join Approval) ===
  bot.on('message:new_chat_members', async (ctx: Context) => {
    const chat = ctx.chat;
    const newMembers = ctx.message?.new_chat_members;
    
    if (!chat || !newMembers || newMembers.length === 0) return;
    
    const groupId = chat.id;
    
    // Get group settings
    const group = await env.DB.prepare(`
      SELECT welcome_message, welcome_media, welcome_buttons, join_approval FROM groups WHERE id = ?
    `).bind(groupId).first<{ welcome_message: string | null; welcome_media: string | null; welcome_buttons: string | null; join_approval: number }>();
    
    // Get global config from dashboard
    const globalConfig = await getGlobalConfig(env);
    const globalWelcome = globalConfig.welcome_message;
    const globalMedia = globalConfig.welcome_media;
    const globalButtons = globalConfig.welcome_buttons;
    
    // Determine if join approval is enabled
    const joinApprovalEnabled = !!group?.join_approval;
    
    for (const member of newMembers) {
      // Skip bots
      if (member.is_bot) continue;
      
      // Add user to database
      await env.DB.prepare(`
        INSERT OR REPLACE INTO users (id, username, first_name, last_name, language_code) 
        VALUES (?, ?, ?, ?, ?)
      `).bind(member.id, member.username || null, member.first_name, member.last_name || null, member.language_code || 'zh').run();
      
      // Add to group members
      await env.DB.prepare(`
        INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)
      `).bind(groupId, member.id).run();
      
      // === Join Approval: mute new member until verified ===
      if (joinApprovalEnabled) {
        try {
          await ctx.api.restrictChatMember(groupId, member.id, {
            can_send_messages: false,
            can_send_audios: false,
            can_send_documents: false,
            can_send_photos: false,
            can_send_videos: false,
            can_send_video_notes: false,
            can_send_voice_notes: false,
            can_send_polls: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
            can_change_info: false,
            can_invite_users: false,
            can_pin_messages: false,
          });
        } catch (e) {
          console.error('Failed to restrict new member:', e);
        }
        
        // Send verification message with button
        const verifyKeyboard = new InlineKeyboard()
          .text('✅ 点击验证身份', 'verify:' + member.id);
        
        await ctx.reply(
          `👋 欢迎 <b>${member.first_name}</b>！\n\n` +
          `本群已启用进群审批，请点击下方按钮验证身份。\n` +
          `验证通过后即可正常发言。`,
          { parse_mode: 'HTML', reply_markup: verifyKeyboard }
        );
        continue;
      }
      
      // === Welcome Message (with optional media + buttons) ===
      let welcomeText = group?.welcome_message || globalWelcome || '';
      const mediaFileId = group?.welcome_media || globalMedia || '';
      let buttonsJson = group?.welcome_buttons || globalButtons || '';
      
      if (welcomeText) {
        welcomeText = welcomeText
          .replace('{first_name}', member.first_name)
          .replace('{last_name}', member.last_name || '')
          .replace('{username}', member.username ? `@${member.username}` : member.first_name)
          .replace('{group_name}', chat.title || 'this group');
      }
      
      // Parse inline keyboard buttons
      let replyMarkup: InlineKeyboard | undefined;
      if (buttonsJson) {
        try {
          const buttons = JSON.parse(buttonsJson);
          if (Array.isArray(buttons) && buttons.length > 0) {
            const keyboard = new InlineKeyboard();
            for (const btn of buttons) {
              if (btn.text && btn.callback_data) {
                keyboard.text(btn.text, btn.callback_data);
              }
              if (btn.url) {
                // URL buttons need row() separation in some cases
              }
            }
            replyMarkup = keyboard;
          }
        } catch (e) {
          console.error('Failed to parse welcome buttons:', e);
        }
      }
      
      if (mediaFileId) {
        // Send photo with caption + buttons
        try {
          if (welcomeText) {
            await ctx.replyWithPhoto(mediaFileId, {
              caption: welcomeText,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            });
          } else {
            await ctx.replyWithPhoto(mediaFileId, { reply_markup: replyMarkup });
          }
        } catch (e) {
          // Fallback to text if photo fails
          console.error('Failed to send welcome photo, fallback to text:', e);
          if (welcomeText) {
            await ctx.reply(welcomeText, { parse_mode: 'HTML', reply_markup: replyMarkup });
          }
        }
      } else if (welcomeText) {
        await ctx.reply(welcomeText, { parse_mode: 'HTML', reply_markup: replyMarkup });
      } else {
        await ctx.reply(
          `👋 欢迎 <b>${member.first_name}</b> 加入群组！\n\n` +
          `使用 /rules 查看群组规则。`,
          { parse_mode: 'HTML' }
        );
      }
    }
  });

  // === Callback Query Handler (Verification + Welcome Buttons) ===
  bot.on('callback_query:data', async (ctx: Context) => {
    const data = ctx.callbackQuery?.data;
    const userId = ctx.from?.id;
    if (!data || !userId) return;
    
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    
    // === Join Approval Verification ===
    if (data.startsWith('verify:')) {
      const targetUserId = Number(data.split(':')[1]);
      
      // Only the target user can verify themselves
      if (userId !== targetUserId) {
        await ctx.answerCallbackQuery({ text: '❌ 这不是你的验证按钮', show_alert: true });
        return;
      }
      
      // Check if already verified
      const existing = await env.DB.prepare(
        'SELECT user_id FROM verified_users WHERE group_id = ? AND user_id = ?'
      ).bind(chatId, userId).first();
      
      if (existing) {
        await ctx.answerCallbackQuery({ text: '✅ 你已经验证过了' });
        return;
      }
      
      // Mark as verified
      await env.DB.prepare(
        'INSERT OR IGNORE INTO verified_users (group_id, user_id) VALUES (?, ?)'
      ).bind(chatId, userId).run();
      
      // Unmute the user
      try {
        await ctx.api.restrictChatMember(chatId, userId, {
          can_send_messages: true,
            can_send_audios: true,
            can_send_documents: true,
            can_send_photos: true,
            can_send_videos: true,
            can_send_video_notes: true,
            can_send_voice_notes: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            can_change_info: false,
            can_invite_users: false,
            can_pin_messages: false,
        });
      } catch (e) {
        console.error('Failed to unmute verified user:', e);
      }
      
      // Update the original message
      try {
        await ctx.editMessageText(
          `✅ 验证成功！欢迎你，<b>${ctx.from.first_name}</b>！\n现在你可以正常发言了。`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        // Message might be deleted already
      }
      
      await ctx.answerCallbackQuery({ text: '✅ 验证成功！你现在可以发言了' });
      return;
    }
    
    // === Welcome Button: Show Rules ===
    if (data === 'show_rules') {
      const group = await env.DB.prepare('SELECT rules FROM groups WHERE id = ?').bind(chatId).first<{ rules: string | null }>();
      const globalConfig = await getGlobalConfig(env);
      const rules = group?.rules || globalConfig.group_rules || '暂无群规';
      await ctx.answerCallbackQuery({ text: rules.substring(0, 200), show_alert: true });
      return;
    }
    
    // === Welcome Button: Acknowledge ===
    if (data === 'acknowledge') {
      await ctx.answerCallbackQuery({ text: '✅ 感谢确认！' });
      return;
    }
    
    // Default: acknowledge unknown callback
    await ctx.answerCallbackQuery({ text: '已收到' });
  });

  // === Left Member Handler ===
  bot.on('message:left_chat_member', async (ctx: Context) => {
    const leftMember = ctx.message?.left_chat_member;
    if (!leftMember || leftMember.is_bot) return;
    
    // Remove from group members
    await env.DB.prepare(`
      DELETE FROM group_members WHERE group_id = ? AND user_id = ?
    `).bind(ctx.chat!.id, leftMember.id).run();
    
    // Remove from verified users
    await env.DB.prepare(`
      DELETE FROM verified_users WHERE group_id = ? AND user_id = ?
    `).bind(ctx.chat!.id, leftMember.id).run();
  });

  // === Anti-Flood Handler (rate limit non-admin messages) ===
  bot.on('message:text').filter(
    async (ctx: Context): Promise<boolean> => {
      if (!ctx.chat || ctx.chat.type === 'private') return false;
      if (!ctx.message?.text || ctx.message.text.startsWith('/')) return false;
      // Skip admins
      if (await isAdmin(ctx, env)) return false;
      // Skip verified check — flood check applies to all non-admin
      return true;
    },
    async (ctx: Context) => {
      if (!ctx.chat || !ctx.from || !ctx.message?.text) return;
      const groupId = ctx.chat.id;
      const userId = ctx.from.id;
      
      // Check antiflood settings
      const floodSettings = await env.DB.prepare(
        'SELECT time_window, max_messages, mute_duration FROM antiflood_settings WHERE group_id = ?'
      ).bind(groupId).first<{ time_window: number; max_messages: number; mute_duration: number }>();
      
      if (!floodSettings) return; // No flood settings = no enforcement
      
      const { time_window: window, max_messages: maxMsgs, mute_duration: muteDur } = floodSettings;
      
      // Use KV to track message timestamps
      const kvKey = 'flood:' + groupId + ':' + userId;
      const now = Date.now();
      const windowMs = window * 1000;
      
      try {
        const stored = await env.CACHE.get(kvKey);
        let timestamps: number[] = stored ? JSON.parse(stored) : [];
        
        // Remove timestamps outside the window
        timestamps = timestamps.filter((t: number) => now - t < windowMs);
        timestamps.push(now);
        
        // Save back to KV (expire after window + buffer)
        await env.CACHE.put(kvKey, JSON.stringify(timestamps), { expirationTtl: window + 10 });
        
        // Check if exceeded
        if (timestamps.length > maxMsgs) {
          // Mute the user
          try {
            const untilDate = Math.floor(now / 1000) + muteDur;
            await ctx.api.restrictChatMember(groupId, userId, {
              can_send_messages: false,
                can_send_audios: false,
                can_send_documents: false,
                can_send_photos: false,
                can_send_videos: false,
                can_send_video_notes: false,
                can_send_voice_notes: false,
                can_send_polls: false,
                can_send_other_messages: false,
                can_add_web_page_previews: false,
                can_change_info: false,
                can_invite_users: false,
                can_pin_messages: false,
              }, { until_date: untilDate });
          } catch (e) {
            console.error('Failed to mute flood user:', e);
          }
          
          // Try to delete the flooding message
          try { await ctx.deleteMessage(); } catch (e) { /* ignore */ }
          
          // Notify briefly (optional - can be removed to be silent)
          console.log('Flood detected: user ' + userId + ' in group ' + groupId + ', muted for ' + muteDur + 's');
        }
      } catch (e) {
        console.error('Anti-flood error:', e);
      }
    }
  );

  // === Note Handler (#keyword trigger) ===
  bot.on('message:text').filter(
    async (ctx: Context): Promise<boolean> => {
      const text = ctx.message?.text;
      if (!text || text.startsWith('/')) return false;
      return true;
    },
    async (ctx: Context) => {
      const text = ctx.message?.text;
      if (!text || !ctx.chat) return;
      
      const groupId = ctx.chat.id;
      const lowerText = text.toLowerCase().trim();
      
      // Check for note match
      const note = await env.DB.prepare(`
        SELECT content FROM notes WHERE group_id = ? AND keyword = ?
      `).bind(groupId, lowerText).first<{ content: string }>();
      
      if (note) {
        await ctx.reply(note.content, { parse_mode: 'HTML' });
        return;
      }
      
      // Check for filter match
      const { results } = await env.DB.prepare(`
        SELECT keyword, response, is_regex, action FROM filters WHERE group_id = ?
      `).bind(groupId).all();
      
      if (results) {
        for (const filter of results as any[]) {
          let matched = false;
          if (filter.is_regex) {
            try {
              const regex = new RegExp(filter.keyword, 'i');
              matched = regex.test(lowerText);
            } catch (e) {
              // Invalid regex, skip
            }
          } else {
            matched = lowerText.includes(filter.keyword.toLowerCase());
          }
          if (matched) {
            if (filter.action === 'delete') {
              try { await ctx.deleteMessage(); } catch (e) { /* ignore */ }
            } else {
              await ctx.reply(filter.response, { parse_mode: 'HTML' });
            }
            return;
          }
        }
      }
    }
  );

  // === Lock Check Handler ===
  bot.on('message').filter(
    async (ctx: Context): Promise<boolean> => {
      const chat = ctx.chat;
      if (!chat || chat.type === 'private') return false;
      
      // Check if user is admin
      if (ctx.from) {
        if (await isAdmin(ctx, env)) return false;
      }
      
      return true;
    },
    async (ctx: Context) => {
      if (!ctx.chat || !ctx.message) return;
      
      const groupId = ctx.chat.id;
      
      // Get active locks
      const { results } = await env.DB.prepare(`
        SELECT lock_type FROM group_locks WHERE group_id = ? AND is_locked = 1
      `).bind(groupId).all();
      
      if (!results || results.length === 0) return;
      
      const lockTypes = (results as any[]).map(r => r.lock_type);
      
      // Check for locked content types
      let shouldDelete = false;
      
      if (lockTypes.includes('all')) {
        shouldDelete = true;
      }
      
      if (lockTypes.includes('sticker') && ctx.message.sticker) {
        shouldDelete = true;
      }
      
      if (lockTypes.includes('gif') && ctx.message.animation) {
        shouldDelete = true;
      }
      
      if (lockTypes.includes('link') && ctx.message.text) {
        const urlRegex = /https?:\/\/[^\s]+/i;
        if (urlRegex.test(ctx.message.text)) {
          shouldDelete = true;
        }
      }
      
      if (lockTypes.includes('media') && (ctx.message.photo || ctx.message.document || ctx.message.video)) {
        shouldDelete = true;
      }
      
      if (shouldDelete) {
        try {
          await ctx.deleteMessage();
        } catch (e) {
          // Ignore delete errors
        }
      }
    }
  );

  // === Chat Member Update Handler (for tracking bot added to groups) ===
  bot.on('chat_member', async (ctx: Context) => {
    const chat = ctx.chat;
    const newChatMember = ctx.myChatMember;
    
    if (!chat || !newChatMember) return;
    
    // Check if bot was added to a group
    if (newChatMember.new_chat_member.status === 'member' || 
        newChatMember.new_chat_member.status === 'administrator') {
      
      // Add group to database
      await env.DB.prepare(`
        INSERT OR IGNORE INTO groups (id, title) VALUES (?, ?)
      `).bind(chat.id, chat.title || 'Unknown').run();
    }
  });

  // === Error Handler ===
  bot.catch((err) => {
    console.error('Bot error:', err);
  });
}
