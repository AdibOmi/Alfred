import { api } from './api';
import { normalizeTask, parseTimestamp, sortTasks, type Task, type TaskDraft, type TaskPatch } from '../shared/tasks';

// Tasks now live in the backend database (per account), so they follow the user
// and the server can email reminders the desktop missed. This module keeps an
// in-memory copy so the reminder sweep and the panel can read it synchronously,
// and refreshes it after every change.

type Listener = (tasks: Task[]) => void;
const listeners = new Set<Listener>();
let cache: Task[] = [];

function publish(tasks: Task[]): Task[] {
  cache = sortTasks(tasks);
  for (const listener of listeners) listener(cache);
  return cache;
}

function fromServer(raw: unknown[]): Task[] {
  return raw.map(normalizeTask).filter((task): task is Task => task !== null);
}

export function onTasksChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listTasks(): Task[] {
  return cache;
}

/** Pulls the latest list from the server. Quietly keeps the old copy when offline. */
export async function refreshTasks(): Promise<Task[]> {
  try {
    return publish(fromServer(await api.listTasks()));
  } catch {
    return cache;
  }
}

export function forgetTasks() {
  publish([]);
}

// Times typed in the panel ("2026-09-22T17:00", no zone) mean local wall-clock time.
// Resolving them here, on the user's machine, sends the server an unambiguous instant.
function toServerTime(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return parseTimestamp(value);
}

export async function addTask(draft: TaskDraft): Promise<Task | null> {
  const created = await api.createTask({ title: draft.title, notes: draft.notes ?? null, remindAt: toServerTime(draft.remindAt) ?? null });
  await refreshTasks();
  return normalizeTask(created);
}

export async function patchTask(id: string, patch: TaskPatch): Promise<Task | null> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.remindAt !== undefined) body.remindAt = toServerTime(patch.remindAt);
  if (patch.done !== undefined) body.done = patch.done;
  const updated = await api.updateTask(id, body);
  await refreshTasks();
  return normalizeTask(updated);
}

export async function removeTask(id: string): Promise<boolean> {
  await api.deleteTask(id);
  await refreshTasks();
  return true;
}

export async function clearCompleted(): Promise<number> {
  const { removed } = await api.clearCompleted();
  await refreshTasks();
  return removed;
}

/** Stamps a reminder as announced so neither the desktop nor the server's email job repeats it. */
export async function markTaskReminded(id: string): Promise<void> {
  // Update the local copy first: if the request is slow, the next sweep must not fire it again.
  publish(cache.map((task) => (task.id === id ? { ...task, remindedAt: new Date().toISOString() } : task)));
  try {
    await api.updateTask(id, { reminded: true });
  } catch {
    // Offline: the local stamp still stops a repeat this session.
  }
}
