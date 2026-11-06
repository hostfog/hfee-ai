import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { db, getSetting } from './db.js';

const scrypt = promisify(crypto.scrypt);

const COOKIE = 'hfee_session';
const SESSION_DAYS = 30;

// Sign-ups start from ALLOW_SIGNUP and can then be switched in the admin page.
export const signupOpen = () => getSetting('signup', process.env.ALLOW_SIGNUP !== 'false');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const actual = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(key, 'hex'));
}

// Sessions are stored hashed so a leaked database can't be used to sign in.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expires);

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 86400_000,
  });
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// requireUser rejects requests without a valid session and sets req.user.
// In single-user mode (the desktop app) there is no sign-in: everyone who
// can reach the server, which only listens on this computer, is the owner.
const SINGLE_USER = process.env.SINGLE_USER === 'true';

function localUser() {
  let user = db.prepare('SELECT id, email, name, role, disabled, plan_id, instructions FROM users ORDER BY id LIMIT 1').get();
  if (!user) {
    db.prepare('INSERT INTO users (email, name, password, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('you@localhost', process.env.SINGLE_USER_NAME || 'You', '!', 'admin', Date.now());
    user = db.prepare('SELECT id, email, name, role, disabled, plan_id, instructions FROM users ORDER BY id LIMIT 1').get();
  }
  return { ...user, local: true };
}

export function requireUser(req, res, next) {
  if (SINGLE_USER) {
    req.user = localUser();
    return next();
  }
  const token = readCookie(req, COOKIE);
  const user = token && db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.disabled, u.plan_id, u.instructions
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(hashToken(token), Date.now());

  if (!user) return res.status(401).json({ error: 'Please sign in' });
  if (user.disabled) return res.status(403).json({ error: 'This account has been disabled' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    next();
  });
}

const publicUser = (u) => ({ id: Number(u.id), email: u.email, name: u.name, role: u.role, local: Boolean(u.local) });

// Slow down password guessing: 10 attempts per IP per 15 minutes.
const attempts = new Map();
function limitAttempts(req, res, next) {
  const now = Date.now();
  const entry = attempts.get(req.ip);
  if (!entry || entry.reset < now) {
    attempts.set(req.ip, { count: 1, reset: now + 15 * 60_000 });
    return next();
  }
  if (++entry.count > 10) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  next();
}

export const authRoutes = Router();

authRoutes.post('/signup', limitAttempts, async (req, res) => {
  if (!signupOpen()) return res.status(403).json({ error: 'Sign-ups are closed' });

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter your name' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // the first account runs the site
  const role = db.prepare('SELECT 1 FROM users').get() ? 'user' : 'admin';
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (email, name, password, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email, name, await hashPassword(password), role, Date.now());

  startSession(res, lastInsertRowid);
  res.json({ user: publicUser({ id: lastInsertRowid, email, name, role }) });
});

authRoutes.post('/login', limitAttempts, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT id, email, name, role, disabled, password FROM users WHERE email = ?').get(email);

  if (!user || !(await checkPassword(password, user.password))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  if (user.disabled) return res.status(403).json({ error: 'This account has been disabled' });

  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRoutes.post('/logout', (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

authRoutes.get('/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRoutes.get('/config', (req, res) => {
  res.json({ signup: signupOpen() });
});

// Remove expired sessions once an hour.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000).unref();
