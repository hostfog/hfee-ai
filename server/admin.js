import { Router } from 'express';
import { db, getSetting, setSetting, startOfDay } from './db.js';
import { requireAdmin, signupOpen } from './auth.js';
import { listModels } from './engines.js';

export const adminRoutes = Router();
adminRoutes.use(requireAdmin);

adminRoutes.get('/overview', (req, res) => {
  const today = startOfDay();
  const week = today - 6 * 86400_000;
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;

  const daily = db.prepare(`
    SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS messages
    FROM messages WHERE role = 'user' AND created_at >= ? GROUP BY day ORDER BY day
  `).all(week);

  res.json({
    users: count('SELECT COUNT(*) AS n FROM users'),
    activeToday: count(`SELECT COUNT(DISTINCT c.user_id) AS n FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.role = 'user' AND m.created_at >= ?`, today),
    messagesToday: count(`SELECT COUNT(*) AS n FROM messages WHERE role = 'user' AND created_at >= ?`, today),
    imagesToday: count('SELECT COUNT(*) AS n FROM images WHERE created_at >= ?', today),
    daily,
  });
});

adminRoutes.get('/users', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.disabled, u.plan_id AS planId, u.created_at AS createdAt,
      (SELECT COUNT(*) FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.user_id = u.id AND m.role = 'user') AS messages
    FROM users u WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.created_at DESC LIMIT 500
  `).all(q, q).map((u) => ({ ...u, disabled: !!u.disabled }));
  res.json({ users });
});

adminRoutes.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (id === req.user.id && (req.body.role === 'user' || req.body.disabled === true)) {
    return res.status(400).json({ error: "You can't remove your own admin access" });
  }

  if (req.body.role === 'user' || req.body.role === 'admin') {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
  }
  if (typeof req.body.disabled === 'boolean') {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(req.body.disabled ? 1 : 0, id);
    if (req.body.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if ('planId' in req.body) {
    const plan = req.body.planId === null ? null : db.prepare('SELECT id FROM plans WHERE id = ?').get(Number(req.body.planId));
    db.prepare('UPDATE users SET plan_id = ? WHERE id = ?').run(plan ? plan.id : null, id);
  }
  res.json({ ok: true });
});

adminRoutes.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete your own account here" });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- plans ------------------------------------------------------------------

adminRoutes.get('/plans', (req, res) => {
  const plans = db.prepare(`
    SELECT p.id, p.name, p.daily_messages AS dailyMessages, p.daily_images AS dailyImages, p.price,
      (SELECT COUNT(*) FROM users u WHERE u.plan_id = p.id) AS users
    FROM plans p ORDER BY p.id
  `).all();
  res.json({ plans });
});

function planFields(body) {
  const name = String(body.name || '').trim().slice(0, 40);
  const dailyMessages = Math.max(0, Math.floor(Number(body.dailyMessages)));
  const dailyImages = Math.max(0, Math.floor(Number(body.dailyImages)));
  if (!name || !Number.isFinite(dailyMessages) || !Number.isFinite(dailyImages)) return null;
  return { name, dailyMessages, dailyImages, price: String(body.price || '').slice(0, 40) };
}

adminRoutes.post('/plans', (req, res) => {
  const p = planFields(req.body);
  if (!p) return res.status(400).json({ error: 'Give the plan a name and limits' });
  try {
    db.prepare('INSERT INTO plans (name, daily_messages, daily_images, price) VALUES (?, ?, ?, ?)').run(p.name, p.dailyMessages, p.dailyImages, p.price);
  } catch {
    return res.status(409).json({ error: 'A plan with this name already exists' });
  }
  res.json({ ok: true });
});

adminRoutes.put('/plans/:id', (req, res) => {
  const p = planFields(req.body);
  if (!p) return res.status(400).json({ error: 'Give the plan a name and limits' });
  db.prepare('UPDATE plans SET name = ?, daily_messages = ?, daily_images = ?, price = ? WHERE id = ?')
    .run(p.name, p.dailyMessages, p.dailyImages, p.price, Number(req.params.id));
  res.json({ ok: true });
});

adminRoutes.delete('/plans/:id', (req, res) => {
  const id = Number(req.params.id);
  const first = db.prepare('SELECT id FROM plans ORDER BY id LIMIT 1').get();
  if (first.id === id) return res.status(400).json({ error: 'The default plan can’t be deleted' });
  db.prepare('UPDATE users SET plan_id = NULL WHERE plan_id = ?').run(id);
  db.prepare('DELETE FROM plans WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- site settings -------------------------------------------------------------

adminRoutes.get('/settings', async (req, res) => {
  res.json({
    signup: signupOpen(),
    defaultModel: getSetting('default_model', process.env.AI_MODEL),
    enabledModels: getSetting('enabled_models', null),
    systemPrompt: getSetting('system_prompt', process.env.SYSTEM_PROMPT || 'You are HFee, a helpful and concise AI assistant.'),
    models: await listModels(),
  });
});

adminRoutes.put('/settings', (req, res) => {
  const b = req.body;
  if (typeof b.signup === 'boolean') setSetting('signup', b.signup);
  if (typeof b.defaultModel === 'string' && b.defaultModel) setSetting('default_model', b.defaultModel);
  if (Array.isArray(b.enabledModels)) setSetting('enabled_models', b.enabledModels.map(String));
  if (typeof b.systemPrompt === 'string' && b.systemPrompt.trim()) setSetting('system_prompt', b.systemPrompt.slice(0, 4000));
  res.json({ ok: true });
});
