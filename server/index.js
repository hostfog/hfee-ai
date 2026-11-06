import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes, requireUser } from './auth.js';
import { chatRoutes, shareRoutes } from './chat.js';
import { accountRoutes } from './account.js';
import { mediaRoutes } from './media.js';
import { adminRoutes } from './admin.js';
import { features, listModels } from './engines.js';
import { getSetting } from './db.js';

const { AI_BASE_URL, AI_MODEL, PORT = 3001, HOST = '127.0.0.1' } = process.env;

if (!AI_BASE_URL || !AI_MODEL) {
  console.error('AI_BASE_URL and AI_MODEL must be set in .env');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 'loopback'); // behind Caddy on the same machine
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

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
  res.json({ models, defaultModel: getSetting('default_model', AI_MODEL), features });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
app.use(express.static(dist));
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, HOST, () => console.log(`HFee AI running on http://${HOST}:${PORT}`));
