import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || 'data/hfee.db';
export const DATA_DIR = path.dirname(path.resolve(file));
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS plans (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    daily_messages INTEGER NOT NULL,
    daily_images   INTEGER NOT NULL,
    price          TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name         TEXT NOT NULL,
    password     TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user',
    disabled     INTEGER NOT NULL DEFAULT 0,
    plan_id      INTEGER REFERENCES plans(id),
    instructions TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_files (
    id         INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    text       TEXT NOT NULL,
    size       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title      TEXT NOT NULL,
    model      TEXT,
    share_id   TEXT UNIQUE,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chats_user ON chats(user_id, updated_at);

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    files      TEXT,
    sources    TEXT,
    steps      TEXT,
    error      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);

  CREATE TABLE IF NOT EXISTS memories (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS images (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS images_user ON images(user_id, created_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Databases created by earlier versions lack some columns.
function addColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
addColumn('users', 'disabled', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'plan_id', 'INTEGER REFERENCES plans(id)');
addColumn('users', 'instructions', "TEXT NOT NULL DEFAULT ''");
addColumn('chats', 'project_id', 'TEXT REFERENCES projects(id) ON DELETE SET NULL');
addColumn('chats', 'model', 'TEXT');
addColumn('chats', 'share_id', 'TEXT');
addColumn('messages', 'sources', 'TEXT');
addColumn('messages', 'steps', 'TEXT');

if (!db.prepare('SELECT 1 FROM plans').get()) {
  db.prepare('INSERT INTO plans (name, daily_messages, daily_images, price) VALUES (?, ?, ?, ?)').run(
    'Free',
    Number(process.env.DAILY_MESSAGES) || 200,
    Number(process.env.DAILY_IMAGES) || 10,
    '',
  );
}

// tx runs fn inside a transaction.
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

// limitsFor returns the user's plan limits (the first plan when none is set).
export function limitsFor(user) {
  if (user.local) return { daily_messages: Infinity, daily_images: Infinity };
  return (
    db.prepare('SELECT * FROM plans WHERE id = ?').get(user.plan_id ?? -1) ??
    db.prepare('SELECT * FROM plans ORDER BY id LIMIT 1').get()
  );
}

export function startOfDay() {
  return new Date().setHours(0, 0, 0, 0);
}
