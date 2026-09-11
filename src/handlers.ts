/**
 * Message handlers for the Telegram Bot
 * Handles non-command events like new members, filters, flood control
 */

import { Bot, Context } from 'grammy';
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

export function setupHandlers(bot: Bot, env: Env): void {
  
  // === New Member Handler ===
  bot.on('message:new_chat_members', async (ctx: Context) => {
    const chat = ctx.chat;
    const newMembers = ctx.message?.new_chat_members;
    
    if (!chat || !newMembers || newMembers.length === 0) return;
    
    const groupId = chat.id;
    
    // Get group settings
    const group = await env.DB.prepare(`
      SELECT welcome_message FROM groups WHERE id = ?
    `).bind(groupId).first<{ welcome_message: string | null }>();
    
    // Get global config from dashboard
    const globalConfig = await getGlobalConfig(env);
    const globalWelcome = globalConfig.welcome_message;
    
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
      
      // Send welcome message - group-specific first, then global config, then default
      let welcomeText = group?.welcome_message || globalWelcome || '';
      
      if (welcomeText) {
        welcomeText = welcomeText
          .replace('{first_name}', member.first_name)
          .replace('{last_name}', member.last_name || '')
          .replace('{username}', member.username ? `@${member.username}` : member.first_name)
          .replace('{group_name}', chat.title || 'this group');
        
        await ctx.reply(welcomeText, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(
          `👋 欢迎 <b>${member.first_name}</b> 加入群组！\n\n` +
          `使用 /rules 查看群组规则。`,
          { parse_mode: 'HTML' }
        );
      }
    }
  });

  // === Left Member Handler ===
  bot.on('message:left_chat_member', async (ctx: Context) => {
    const leftMember = ctx.message?.left_chat_member;
    if (!leftMember || leftMember.is_bot) return;
    
    // Remove from group members
    await env.DB.prepare(`
      DELETE FROM group_members WHERE group_id = ? AND user_id = ?
    `).bind(ctx.chat!.id, leftMember.id).run();
  });

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
        SELECT keyword, response, is_regex FROM filters WHERE group_id = ?
      `).bind(groupId).all();
      
      if (results) {
        for (const filter of results as any[]) {
          if (filter.is_regex) {
            try {
              const regex = new RegExp(filter.keyword, 'i');
              if (regex.test(lowerText)) {
                await ctx.reply(filter.response, { parse_mode: 'HTML' });
                return;
              }
            } catch (e) {
              // Invalid regex, skip
            }
          } else {
            if (lowerText.includes(filter.keyword.toLowerCase())) {
              await ctx.reply(filter.response, { parse_mode: 'HTML' });
              return;
            }
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
        const isBotAdmin = env.ADMIN_IDS.split(',').map(Number).includes(ctx.from.id);
        if (isBotAdmin) return false;
        
        try {
          const member = await ctx.getChatMember(ctx.from.id);
          if (member.status === 'administrator' || member.status === 'creator') {
            return false;
          }
        } catch (e) {
          // Ignore errors
        }
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

  // === Chat Member Update Handler (for tracking admin changes) ===
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
