import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, tx, getSetting, limitsFor, startOfDay, DATA_DIR } from './db.js';
import { requireUser } from './auth.js';
import { features, search, defaultModel, VISION_MODEL } from './engines.js';
import { Turn, chat as runChat, research, makeImage, toolPrompt } from './agent.js';

const MAX_HISTORY = 20;
const PROJECT_CHARS = 24_000; // project files shared with the model per message
export const IMAGE_DIR = path.join(DATA_DIR, 'images');
fs.mkdirSync(IMAGE_DIR, { recursive: true });

export const chatRoutes = Router();
export const shareRoutes = Router();
chatRoutes.use(requireUser);

chatRoutes.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [req.user.id];
  let where = 'c.user_id = ?';
  if (req.query.project) {
    where += ' AND c.project_id = ?';
    params.push(String(req.query.project));
  }
  if (q) {
    where += ` AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.content LIKE ?))`;
    params.push(`%${q}%`, `%${q}%`);
  }
  const chats = db
    .prepare(`SELECT c.id, c.title, c.project_id AS projectId FROM chats c WHERE ${where} ORDER BY c.updated_at DESC LIMIT 200`)
    .all(...params);
  res.json({ chats });
});

chatRoutes.get('/:id', (req, res) => {
  const chat = findChat(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  res.json({ ...chat, messages: loadMessages(chat.id) });
});

chatRoutes.patch('/:id', (req, res) => {
  const chat = findChat(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  if (typeof req.body.title === 'string' && req.body.title.trim()) {
    db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(req.body.title.trim().slice(0, 100), chat.id);
  }
  if (typeof req.body.model === 'string') {
    db.prepare('UPDATE chats SET model = ? WHERE id = ?').run(req.body.model, chat.id);
  }
  res.json(findChat(chat.id, req.user.id));
});

chatRoutes.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

chatRoutes.post('/:id/share', (req, res) => {
  const chat = findChat(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const shareId = chat.shareId || crypto.randomBytes(12).toString('base64url');
  db.prepare('UPDATE chats SET share_id = ? WHERE id = ?').run(shareId, chat.id);
  res.json({ shareId });
});

chatRoutes.delete('/:id/share', (req, res) => {
  db.prepare('UPDATE chats SET share_id = NULL WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Shared chats are readable by anyone with the link.
shareRoutes.get('/:shareId', (req, res) => {
  const chat = db.prepare('SELECT id, title FROM chats WHERE share_id = ?').get(String(req.params.shareId));
  if (!chat) return res.status(404).json({ error: 'This link is no longer shared' });
  res.json({ title: chat.title, messages: loadMessages(chat.id, req.params.shareId) });
});

// POST /api/chats/send streams the reply as server-sent events:
//   {chat:{id,title}}  {queue:n}  {status:"..."}  {sources:[...]}  {token:"..."}
//   {image:{...}}  {error:"..."}  {done:true}
chatRoutes.post('/send', async (req, res) => {
  const user = req.user;
  const content = String(req.body.content || '').trim();
  const files = Array.isArray(req.body.files) ? req.body.files.slice(0, 10).map(cleanFile) : [];
  const wantImage = req.body.mode === 'image';
  if (!content && files.length === 0) return res.status(400).json({ error: 'Message is empty' });
  if (wantImage && !features.images) return res.status(400).json({ error: 'Image generation is not set up' });
  if (wantImage && !content) return res.status(400).json({ error: 'Describe the image you want' });

  const limits = limitsFor(user);
  const sent = db.prepare(`
    SELECT COUNT(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id
    WHERE c.user_id = ? AND m.role = 'user' AND m.created_at >= ?
  `).get(user.id, startOfDay()).n;
  if (sent >= limits.daily_messages) {
    return res.status(429).json({ error: `You've reached today's limit of ${limits.daily_messages} messages` });
  }
  if (wantImage) {
    const made = db.prepare('SELECT COUNT(*) AS n FROM images WHERE user_id = ? AND created_at >= ?').get(user.id, startOfDay()).n;
    if (made >= limits.daily_images) {
      return res.status(429).json({ error: `You've reached today's limit of ${limits.daily_images} images` });
    }
  }

  const projectId = req.body.projectId && ownsProject(String(req.body.projectId), user.id) ? String(req.body.projectId) : null;
  let chat = req.body.chatId && findChat(req.body.chatId, user.id);
  tx(() => {
    if (!chat) {
      chat = { id: crypto.randomUUID(), title: (content || files[0].name).slice(0, 60), projectId };
      db.prepare('INSERT INTO chats (id, user_id, project_id, title, model, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(chat.id, user.id, projectId, chat.title, req.body.model || null, Date.now());
    } else if (req.body.model) {
      db.prepare('UPDATE chats SET model = ? WHERE id = ?').run(req.body.model, chat.id);
    }
    saveMessage(chat.id, 'user', content, files);
  });

  const remembered = rememberIfAsked(user.id, content);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ chat: { id: chat.id, title: chat.title, projectId: chat.projectId ?? projectId } });

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const model = files.some((f) => f.kind === 'image') && features.vision
    ? VISION_MODEL
    : req.body.model || chat.model || (await defaultModel());

  const imagesToday = () => db.prepare('SELECT COUNT(*) AS n FROM images WHERE user_id = ? AND created_at >= ?').get(user.id, startOfDay()).n;
  const turn = new Turn({
    user, model, send, signal: controller.signal, imageDir: IMAGE_DIR,
    canMakeImage: () => imagesToday() < limits.daily_images,
  });

  try {
    if (wantImage) {
      const s = turn.step('Creating an image — about a minute', { detail: content });
      const id = await makeImage(turn, content);
      turn.files.push({ id, kind: 'image', name: `${content.slice(0, 40)}.png`, url: `/api/images/${id}`, size: 0 });
      send({ files: turn.files });
      s.done();
    } else if (req.body.research && features.search) {
      await research(turn, content, systemPrompt(user, chat, [], null, false));
    } else {
      if (req.body.search && features.search) {
        const s = turn.step(`Searching the web for “${content.slice(0, 80)}”`);
        const found = turn.addSources(await search(content).catch(() => []));
        s.done({ detail: found.map((r) => `[${r.n}] ${r.title}`).join('\n') });
      }
      // the vision model is used on its own, without tools
      const tools = model !== VISION_MODEL;
      const messages = [{ role: 'system', content: systemPrompt(user, chat, turn.sources, remembered, tools) }, ...history(chat.id)];
      await runChat(turn, messages);
    }
    saveTurn(chat.id, turn);
    send({ done: true });
  } catch (err) {
    if (controller.signal.aborted) {
      if (turn.text || turn.files.length) saveTurn(chat.id, turn);
    } else {
      console.error(err);
      const message = err.userMessage || (wantImage ? "Couldn't create the image. Please try again." : 'The model is not responding. Please try again.');
      if (turn.text) saveTurn(chat.id, turn);
      else saveMessage(chat.id, 'assistant', message, null, true, null, turn.steps);
      send({ error: message });
    }
  } finally {
    res.end();
  }
});

function saveTurn(chatId, turn) {
  saveMessage(chatId, 'assistant', turn.text, turn.files, false, turn.sources, turn.steps);
}

function systemPrompt(user, chat, sources, remembered, tools) {
  const parts = [
    getSetting('system_prompt', process.env.SYSTEM_PROMPT || 'You are HFee, a helpful and concise AI assistant.'),
    `Today is ${new Date().toDateString()}. The user's name is ${user.name}.`,
    'Format replies with Markdown. Put code in fenced code blocks with a language, and complete web pages in a single ```html block.',
  ];

  if (user.instructions) parts.push(`The user's instructions for how you respond:\n${user.instructions}`);

  const memories = db.prepare('SELECT content FROM memories WHERE user_id = ? ORDER BY id').all(user.id);
  if (memories.length) parts.push(`Things the user asked you to remember:\n${memories.map((m) => `- ${m.content}`).join('\n')}`);

  const projectId = chat.projectId ?? db.prepare('SELECT project_id FROM chats WHERE id = ?').get(chat.id)?.project_id;
  if (projectId) {
    const project = db.prepare('SELECT name, instructions FROM projects WHERE id = ?').get(projectId);
    parts.push(`This chat is part of the project "${project.name}".${project.instructions ? `\n${project.instructions}` : ''}`);

    let budget = PROJECT_CHARS;
    for (const f of db.prepare('SELECT name, text FROM project_files WHERE project_id = ? ORDER BY id').all(projectId)) {
      if (budget <= 0) break;
      const text = f.text.slice(0, budget);
      budget -= text.length;
      parts.push(`<project_file name="${f.name}">\n${text}\n</project_file>`);
    }
  }

  if (remembered) {
    parts.push(`The user just asked you to remember "${remembered}". It is saved to their memory; confirm that briefly.`);
  }

  if (sources?.length) {
    const list = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.snippet}`).join('\n\n');
    parts.push(`Web search results for the user's latest message. Use them and cite them as [1], [2]:\n\n${list}`);
  }

  if (tools) parts.push(toolPrompt());
  return parts.join('\n\n');
}

// "remember that …" saves a memory as well as being answered normally.
function rememberIfAsked(userId, content) {
  const match = content.match(/^(?:please\s+)?remember(?:\s+that)?[,:]?\s+(.{3,500})$/is);
  if (!match) return null;
  const memory = match[1].trim();
  db.prepare('INSERT INTO memories (user_id, content, created_at) VALUES (?, ?, ?)').run(userId, memory, Date.now());
  return memory;
}

function findChat(id, userId) {
  return db
    .prepare('SELECT id, title, project_id AS projectId, model, share_id AS shareId FROM chats WHERE id = ? AND user_id = ?')
    .get(String(id), userId);
}

function ownsProject(id, userId) {
  return Boolean(db.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(id, userId));
}

function loadMessages(chatId, shareId) {
  return db
    .prepare('SELECT role, content, files, sources, steps, error FROM messages WHERE chat_id = ? ORDER BY id')
    .all(chatId)
    .map((m) => {
      let files = m.files ? JSON.parse(m.files) : undefined;
      if (shareId && files) {
        files = files.map((f) => (f.url ? { ...f, url: `/api/share/${shareId}/images/${f.id}` } : f));
      }
      const parse = (v) => (v ? JSON.parse(v) : undefined);
      return { role: m.role, content: m.content, files, sources: parse(m.sources), steps: parse(m.steps), error: !!m.error };
    });
}

function saveMessage(chatId, role, content, files = null, error = false, sources = null, steps = null) {
  const json = (v) => (v?.length ? JSON.stringify(v) : null);
  db.prepare('INSERT INTO messages (chat_id, role, content, files, sources, steps, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(chatId, role, content, json(files), json(sources), json(steps), error ? 1 : 0, Date.now());
  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(Date.now(), chatId);
}

// cleanFile keeps only the fields the app uses.
function cleanFile(f) {
  const out = { id: String(f.id || crypto.randomUUID()), name: String(f.name || 'file').slice(0, 200), size: Number(f.size) || 0 };
  if (f.kind === 'image' && typeof f.data === 'string' && f.data.startsWith('data:image/')) {
    return { ...out, kind: 'image', data: f.data };
  }
  return { ...out, kind: 'text', text: String(f.text || ''), truncated: !!f.truncated };
}

function history(chatId) {
  return db
    .prepare('SELECT role, content, files FROM messages WHERE chat_id = ? AND error = 0 ORDER BY id DESC LIMIT ?')
    .all(chatId, MAX_HISTORY)
    .reverse()
    .map((m) => toModelMessage(m.role, m.content, m.files ? JSON.parse(m.files) : []))
    .filter((m) => m.content.length > 0);
}

// toModelMessage inlines text attachments and sends uploaded images as
// OpenAI image parts. Models without vision ignore the image parts.
function toModelMessage(role, content, files) {
  const docs = files
    .filter((f) => f.kind === 'text')
    .map((f) => `<file name="${f.name}">\n${f.text}\n</file>`);
  const text = [...docs, content].filter(Boolean).join('\n\n');

  const images = files.filter((f) => f.kind === 'image' && f.data);
  if (role !== 'user' || images.length === 0) return { role, content: text };

  return {
    role,
    content: [
      ...images.map((f) => ({ type: 'image_url', image_url: { url: f.data } })),
      { type: 'text', text: text || 'Describe this image.' },
    ],
  };
}
