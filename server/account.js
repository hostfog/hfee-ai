// The user's own settings: instructions, memory and projects.

import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from './db.js';
import { requireUser } from './auth.js';

export const accountRoutes = Router();
accountRoutes.use(requireUser);

accountRoutes.get('/settings', (req, res) => {
  const memories = db.prepare('SELECT id, content FROM memories WHERE user_id = ? ORDER BY id').all(req.user.id);
  res.json({ instructions: req.user.instructions, memories });
});

accountRoutes.put('/instructions', (req, res) => {
  const text = String(req.body.instructions || '').slice(0, 4000);
  db.prepare('UPDATE users SET instructions = ? WHERE id = ?').run(text, req.user.id);
  res.json({ instructions: text });
});

accountRoutes.post('/memories', (req, res) => {
  const content = String(req.body.content || '').trim().slice(0, 500);
  if (!content) return res.status(400).json({ error: 'Memory is empty' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO memories (user_id, content, created_at) VALUES (?, ?, ?)')
    .run(req.user.id, content, Date.now());
  res.json({ id: Number(lastInsertRowid), content });
});

accountRoutes.delete('/memories/:id', (req, res) => {
  db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// --- projects -----------------------------------------------------------

const MAX_PROJECT_FILES = 20;

function findProject(id, userId) {
  return db.prepare('SELECT id, name, instructions FROM projects WHERE id = ? AND user_id = ?').get(String(id), userId);
}

accountRoutes.get('/projects', (req, res) => {
  res.json({
    projects: db.prepare('SELECT id, name FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id),
  });
});

accountRoutes.post('/projects', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Name the project' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO projects (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, name, Date.now());
  res.json({ id, name });
});

accountRoutes.get('/projects/:id', (req, res) => {
  const project = findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const files = db.prepare('SELECT id, name, size FROM project_files WHERE project_id = ? ORDER BY id').all(project.id);
  res.json({ ...project, files });
});

accountRoutes.patch('/projects/:id', (req, res) => {
  const project = findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : project.name;
  const instructions = typeof req.body.instructions === 'string' ? req.body.instructions.slice(0, 4000) : project.instructions;
  db.prepare('UPDATE projects SET name = ?, instructions = ? WHERE id = ?').run(name, instructions, project.id);
  res.json({ ...project, name, instructions });
});

accountRoutes.delete('/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(String(req.params.id), req.user.id);
  res.json({ ok: true });
});

accountRoutes.post('/projects/:id/files', (req, res) => {
  const project = findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const count = db.prepare('SELECT COUNT(*) AS n FROM project_files WHERE project_id = ?').get(project.id).n;
  if (count >= MAX_PROJECT_FILES) return res.status(400).json({ error: `A project can hold ${MAX_PROJECT_FILES} files` });

  const name = String(req.body.name || 'file').slice(0, 200);
  const text = String(req.body.text || '');
  if (!text) return res.status(400).json({ error: 'Only text, code and PDF files can be added to projects' });

  const { lastInsertRowid } = db
    .prepare('INSERT INTO project_files (project_id, name, text, size) VALUES (?, ?, ?, ?)')
    .run(project.id, name, text, Number(req.body.size) || text.length);
  res.json({ id: Number(lastInsertRowid), name, size: Number(req.body.size) || text.length });
});

accountRoutes.delete('/projects/:id/files/:fileId', (req, res) => {
  const project = findProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  db.prepare('DELETE FROM project_files WHERE id = ? AND project_id = ?').run(Number(req.params.fileId), project.id);
  res.json({ ok: true });
});
