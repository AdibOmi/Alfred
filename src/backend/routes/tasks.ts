import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { Db } from '../db';
import { parseTaskText } from '../taskParser';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  due: string;
  status: 'active' | 'done';
  created_at: string;
  notified_at: string | null;
}

export function tasksRouter(db: Db, anthropicApiKey: string | undefined) {
  const router = Router();

  router.get('/', (_req, res) => {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY due ASC').all();
    res.json({ tasks });
  });

  router.post('/', (req, res) => {
    const { title, due, notes } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim() || typeof due !== 'string') {
      return res.status(400).json({ error: 'title and due are required' });
    }
    const task: Task = {
      id: randomUUID(),
      title: title.trim(),
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      due,
      status: 'active',
      created_at: new Date().toISOString(),
      notified_at: null,
    };
    db.prepare(
      'INSERT INTO tasks (id, title, notes, due, status, created_at, notified_at) VALUES (@id, @title, @notes, @due, @status, @created_at, @notified_at)',
    ).run(task);
    res.status(201).json({ task });
  });

  // Natural-language quick capture: "submit report friday 5pm" -> a scheduled task.
  router.post('/quick', async (req, res) => {
    const { text } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const parsed = await parseTaskText(text.trim(), anthropicApiKey);
    const task: Task = {
      id: randomUUID(),
      title: parsed.title,
      notes: null,
      due: parsed.due,
      status: 'active',
      created_at: new Date().toISOString(),
      notified_at: null,
    };
    db.prepare(
      'INSERT INTO tasks (id, title, notes, due, status, created_at, notified_at) VALUES (@id, @title, @notes, @due, @status, @created_at, @notified_at)',
    ).run(task);
    res.status(201).json({ task, usedFallbackParser: parsed.usedFallback });
  });

  router.patch('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as Task | undefined;
    if (!existing) return res.status(404).json({ error: 'not found' });

    const { title, due, notes, status } = req.body ?? {};
    const updated: Task = {
      ...existing,
      title: typeof title === 'string' && title.trim() ? title.trim() : existing.title,
      due: typeof due === 'string' ? due : existing.due,
      notes: typeof notes === 'string' ? notes : existing.notes,
      status: status === 'active' || status === 'done' ? status : existing.status,
    };
    db.prepare('UPDATE tasks SET title = @title, due = @due, notes = @notes, status = @status WHERE id = @id').run(updated);
    res.json({ task: updated });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  return router;
}
