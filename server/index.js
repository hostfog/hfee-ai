import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes, requireUser } from './auth.js';
import { chatRoutes, shareRoutes } from './chat.js';
import { accountRoutes } from './account.js';
import { mediaRoutes } from './media.js';
import { adminRoutes } from './admin.js';
import { features, listModels, defaultModel } from './engines.js';
import { getSetting } from './db.js';

const { AI_BASE_URL, AI_MODEL, PORT = 3001, HOST = '127.0.0.1' } = process.env;
const DESKTOP = process.env.DESKTOP === 'true';

if (!AI_BASE_URL || !AI_MODEL) {
  console.error('AI_BASE_URL and AI_MODEL must be set in .env');
  process.exit(1);
}

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback'); // Caddy in front
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

// The desktop app has no sign-in, so only answer pages opened on this computer
// (blocks other websites reaching it through DNS rebinding).
if (DESKTOP) {
  app.use((req, res, next) => (['127.0.0.1', 'localhost'].includes(req.hostname) ? next() : res.status(403).end()));
}

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', mediaRoutes);

// What the signed-in user can use: models to pick from and optional features.
app.get('/api/config', requireUser, async (req, res) => {
  const enabled = getSetting('enabled_models', null);
  const models = (await listModels()).filter((m) => !enabled || enabled.includes(m));
  res.json({ models, defaultModel: await defaultModel(models), features, desktop: DESKTOP });
});

// The desktop app stops when its owner chooses Quit.
if (DESKTOP) {
  app.post('/api/quit', requireUser, (req, res) => {
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 200);
  });
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
app.use(express.static(dist));
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, HOST, () => console.log(`HFee AI running on http://${HOST}:${PORT}`));
