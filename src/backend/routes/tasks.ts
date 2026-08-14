import { Router } from 'express';
import type { Db } from '../db';
import { parseTaskText } from '../taskParser';
import { createTask, type Task, type TaskKind } from '../taskActions';

function asKind(value: unknown): TaskKind | undefined {
  return value === 'deadline' || value === 'todo' ? value : undefined;
}

export function tasksRouter(db: Db, anthropicApiKey: string | undefined) {
  const router = Router();

  router.get('/', (_req, res) => {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY due ASC').all();
    res.json({ tasks });
  });

  router.post('/', (req, res) => {
    const { title, due, notes, kind } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const task = createTask(db, {
      title: title.trim(),
      due: typeof due === 'string' && due ? due : null,
      notes,
      kind: asKind(kind),
    });
    res.status(201).json({ task });
  });

  // Natural-language quick capture: "submit report friday 5pm" -> a scheduled task.
  // `kind` is an optional explicit override from the caller's UI (a user-picked
  // Deadline/To-do toggle); when omitted, the parser's own classification is used.
  router.post('/quick', async (req, res) => {
    const { text, kind } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const parsed = await parseTaskText(text.trim(), anthropicApiKey);
    const task = createTask(db, { title: parsed.title, due: parsed.due, kind: asKind(kind) ?? parsed.kind });
    res.status(201).json({ task, usedFallbackParser: parsed.usedFallback });
  });

  router.patch('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as Task | undefined;
    if (!existing) return res.status(404).json({ error: 'not found' });

    const { title, due, notes, status, kind } = req.body ?? {};
    const updated: Task = {
      ...existing,
      title: typeof title === 'string' && title.trim() ? title.trim() : existing.title,
      due: due === null ? null : typeof due === 'string' && due ? due : existing.due,
      notes: typeof notes === 'string' ? notes : existing.notes,
      status: status === 'active' || status === 'done' ? status : existing.status,
      kind: asKind(kind) ?? existing.kind,
    };
    db.prepare('UPDATE tasks SET title = @title, due = @due, notes = @notes, status = @status, kind = @kind WHERE id = @id').run(
      updated,
    );
    res.json({ task: updated });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  return router;
}
