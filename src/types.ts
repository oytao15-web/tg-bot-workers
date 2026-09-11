/**
 * Type definitions for Cloudflare Workers environment
 */

export interface Env {
  // Secrets and variables
  BOT_TOKEN: string;
  BOT_USERNAME: string;
  ADMIN_IDS: string;
  
  // Cloudflare bindings
  DB: D1Database;
  CACHE: KVNamespace;
  
  // Environment
  ENVIRONMENT: string;
}

/**
 * Telegram Update types (simplified)
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
  chat_member?: ChatMemberUpdated;
  my_chat_member?: ChatMemberUpdated;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  reply_to_message?: TelegramMessage;
  sticker?: Sticker;
  animation?: Animation;
  document?: Document;
  photo?: PhotoSize[];
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface ChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: ChatMember;
  new_chat_member: ChatMember;
}

export interface ChatMember {
  user: TelegramUser;
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
}

export interface Sticker {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  emoji?: string;
}

export interface Animation {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
}

export interface Document {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
}

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/**
 * Command handler type
 */
export type CommandHandler = (ctx: any) => Promise<void>;

/**
 * Command definition
 */
export interface Command {
  command: string;
  description: string;
  handler: CommandHandler;
  adminOnly?: boolean;
  groupOnly?: boolean;
}
