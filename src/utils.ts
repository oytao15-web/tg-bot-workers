/**
 * Utility functions for the Telegram Bot
 */

import { Context } from 'grammy';

/**
 * Check if a user is an admin in the chat
 */
export async function isGroupAdmin(ctx: Context, userId: number): Promise<boolean> {
  if (!ctx.chat || ctx.chat.type === 'private') return false;
  
  try {
    const member = await ctx.getChatMember(userId);
    return member.status === 'administrator' || member.status === 'creator';
  } catch (error) {
    return false;
  }
}

/**
 * Check if a user is the bot admin (from env config)
 */
export function isBotAdmin(adminIds: string, userId: number): boolean {
  const ids = adminIds.split(',').map(Number);
  return ids.includes(userId);
}

/**
 * Get user mention string
 */
export function getUserMention(user: { id: number; first_name: string; last_name?: string; username?: string }): string {
  const name = user.last_name ? `${user.first_name} ${user.last_name}` : user.first_name;
  if (user.username) {
    return `@${user.username}`;
  }
  return `<a href="tg://user?id=${user.id}">${name}</a>`;
}

/**
 * Parse time string to seconds
 */
export function parseTime(timeStr: string): number {
  const match = timeStr.match(/^(\d+)(s|m|h|d|w)?$/i);
  if (!match) return 0;
  
  const value = parseInt(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    case 'w': return value * 604800;
    default: return value * 60;
  }
}

/**
 * Format seconds to human-readable duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}天`;
  return `${Math.floor(seconds / 604800)}周`;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Generate a random string
 */
export function randomString(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}
