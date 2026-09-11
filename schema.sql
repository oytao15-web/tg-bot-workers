-- Telegram Bot D1 Database Schema
-- Compatible with Cloudflare D1 (SQLite-based)

-- Groups/Chats table
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

-- Users table
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

-- Group members (many-to-many)
CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',  -- member, admin, creator
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Warnings
CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    admin_id INTEGER NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Notes (saved messages)
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    content TEXT NOT NULL,
    file_id TEXT,
    file_type TEXT,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Filters (auto-reply)
CREATE TABLE IF NOT EXISTS filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    response TEXT NOT NULL,
    is_regex INTEGER DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Group settings/locks
CREATE TABLE IF NOT EXISTS group_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    lock_type TEXT NOT NULL,  -- sticker, gif, link, media, etc.
    is_locked INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Action logs
CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Invite links (promotion)
CREATE TABLE IF NOT EXISTS invite_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    link TEXT NOT NULL UNIQUE,
    name TEXT,
    created_by INTEGER NOT NULL,
    max_uses INTEGER DEFAULT 0,
    current_uses INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Invite tracking
CREATE TABLE IF NOT EXISTS invite_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_link_id INTEGER NOT NULL,
    invited_user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invite_link_id) REFERENCES invite_links(id)
);

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    file_id TEXT,
    file_type TEXT,
    created_by INTEGER NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Scheduled announcements
CREATE TABLE IF NOT EXISTS scheduled_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    scheduled_time DATETIME NOT NULL,
    is_sent INTEGER DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Announcement templates
CREATE TABLE IF NOT EXISTS announcement_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Anti-flood settings
CREATE TABLE IF NOT EXISTS antiflood_settings (
    group_id INTEGER PRIMARY KEY,
    max_messages INTEGER DEFAULT 5,
    time_window INTEGER DEFAULT 10,  -- seconds
    action TEXT DEFAULT 'mute',  -- mute, kick, ban
    FOREIGN KEY (group_id) REFERENCES groups(id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_warnings_group ON warnings(group_id);
CREATE INDEX IF NOT EXISTS idx_notes_group_keyword ON notes(group_id, keyword);
CREATE INDEX IF NOT EXISTS idx_filters_group ON filters(group_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_group ON action_logs(group_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_time ON scheduled_announcements(scheduled_time, is_sent);
CREATE INDEX IF NOT EXISTS idx_invite_link ON invite_links(link);
