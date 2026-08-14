import { randomUUID } from 'crypto';
import type { Db } from './db';

export type TaskKind = 'deadline' | 'todo';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  due: string | null;
  kind: TaskKind;
  status: 'active' | 'done';
  created_at: string;
  notified_at: string | null;
}

export function createTask(
  db: Db,
  input: { title: string; due: string | null; notes?: string | null; kind?: TaskKind },
): Task {
  const task: Task = {
    id: randomUUID(),
    title: input.title,
    notes: input.notes?.trim() || null,
    due: input.due,
    // No explicit kind given (e.g. plain API callers): fall back to the old
    // due-based convention so untouched callers keep their prior behavior.
    kind: input.kind ?? (input.due ? 'deadline' : 'todo'),
    status: 'active',
    created_at: new Date().toISOString(),
    notified_at: null,
  };
  db.prepare(
    'INSERT INTO tasks (id, title, notes, due, kind, status, created_at, notified_at) VALUES (@id, @title, @notes, @due, @kind, @status, @created_at, @notified_at)',
  ).run(task);
  return task;
}

export function listActiveTasks(db: Db): Task[] {
  return db.prepare("SELECT * FROM tasks WHERE status = 'active' ORDER BY due ASC").all() as Task[];
}

// Matched by id first, then an exact (case-insensitive) title match, then a title
// substring — lets chat tool calls reference a task by whatever the user typed.
export function findTaskByQuery(db: Db, query: string): Task | undefined {
  const byId = db.prepare('SELECT * FROM tasks WHERE id = ?').get(query) as Task | undefined;
  if (byId) return byId;

  const active = listActiveTasks(db);
  const lower = query.trim().toLowerCase();
  return active.find((task) => task.title.toLowerCase() === lower) ?? active.find((task) => task.title.toLowerCase().includes(lower));
}

export function completeTaskByQuery(db: Db, query: string): Task | undefined {
  const task = findTaskByQuery(db, query);
  if (!task) return undefined;
  db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(task.id);
  return { ...task, status: 'done' };
}

export function deleteTaskByQuery(db: Db, query: string): Task | undefined {
  const task = findTaskByQuery(db, query);
  if (!task) return undefined;
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  return task;
}
