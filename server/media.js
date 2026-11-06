// Generated images, speech and the code sandbox.

import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { db } from './db.js';
import { requireUser } from './auth.js';
import { IMAGE_DIR, shareRoutes } from './chat.js';
import { features, runPython, speak, transcribe } from './engines.js';

export const mediaRoutes = Router();

function sendImage(res, id) {
  const file = path.join(IMAGE_DIR, `${path.basename(id)}.png`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Image not found' });
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(file);
}

// Gallery of the user's generated images.
mediaRoutes.get('/images', requireUser, (req, res) => {
  const images = db
    .prepare('SELECT id, prompt, created_at AS createdAt FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT 500')
    .all(req.user.id)
    .map((img) => ({ ...img, url: `/api/images/${img.id}` }));
  res.json({ images });
});

mediaRoutes.get('/images/:id', requireUser, (req, res) => {
  const owned = db.prepare('SELECT 1 FROM images WHERE id = ? AND user_id = ?').get(String(req.params.id), req.user.id);
  if (!owned) return res.status(404).json({ error: 'Image not found' });
  sendImage(res, req.params.id);
});

mediaRoutes.delete('/images/:id', requireUser, (req, res) => {
  const { changes } = db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(String(req.params.id), req.user.id);
  if (changes) fs.rmSync(path.join(IMAGE_DIR, `${path.basename(req.params.id)}.png`), { force: true });
  res.json({ ok: true });
});

// Images inside a shared chat are visible through its link.
shareRoutes.get('/:shareId/images/:id', (req, res) => {
  const shared = db.prepare(`
    SELECT 1 FROM chats c JOIN images i ON i.user_id = c.user_id
    WHERE c.share_id = ? AND i.id = ?
      AND EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.files LIKE ?)
  `).get(String(req.params.shareId), String(req.params.id), `%${req.params.id}%`);
  if (!shared) return res.status(404).json({ error: 'Image not found' });
  sendImage(res, req.params.id);
});

// --- speech ---------------------------------------------------------------

mediaRoutes.post('/voice/transcribe', requireUser, express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  if (!features.voiceIn) return res.status(400).json({ error: 'Voice input is not set up' });
  try {
    res.json({ text: await transcribe(req.body) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't understand the recording" });
  }
});

mediaRoutes.post('/voice/speak', requireUser, async (req, res) => {
  if (!features.voiceOut) return res.status(400).json({ error: 'Read aloud is not set up' });
  const text = String(req.body.text || '')
    .replace(/```[\s\S]*?```/g, ' ') // skip code blocks
    .replace(/[*_#>`|]/g, '')
    .slice(0, 5000);
  if (!text.trim()) return res.status(400).json({ error: 'Nothing to read' });
  try {
    res.setHeader('Content-Type', 'audio/wav');
    res.send(await speak(text));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't read this aloud" });
  }
});

// --- code sandbox ---------------------------------------------------------

let running = 0;
const MAX_RUNS = 2;

mediaRoutes.post('/run', requireUser, async (req, res) => {
  if (!features.code) return res.status(400).json({ error: 'Running code is not set up' });
  const code = String(req.body.code || '');
  if (!code.trim()) return res.status(400).json({ error: 'No code to run' });
  if (code.length > 100_000) return res.status(400).json({ error: 'Code is too long' });
  if (running >= MAX_RUNS) return res.status(429).json({ error: 'The sandbox is busy, try again in a moment' });

  running++;
  try {
    res.json(await runPython(code));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't run the code" });
  } finally {
    running--;
  }
});
