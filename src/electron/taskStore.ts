import { randomUUID } from 'crypto';
import Store from 'electron-store';
import {
  applyPatch,
  createTask,
  markReminded,
  normalizeTask,
  sortTasks,
  type Task,
  type TaskDraft,
  type TaskPatch,
} from '../shared/tasks';

interface TaskStoreSchema {
  tasks: unknown[];
}

// Tasks live in their own file rather than alongside the API key and window
// prefs: the list is the only part of Alfred's state that grows unboundedly,
// and a corrupt task list should never be able to cost someone their API key.
const store = new Store<TaskStoreSchema>({
  name: 'alfred-tasks',
  defaults: { tasks: [] },
});

type Listener = (tasks: Task[]) => void;
const listeners = new Set<Listener>();

function read(): Task[] {
  const raw = store.get('tasks');
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeTask).filter((task): task is Task => task !== null);
}

function write(tasks: Task[]): Task[] {
  const sorted = sortTasks(tasks);
  store.set('tasks', sorted);
  for (const listener of listeners) listener(sorted);
  return sorted;
}

export function onTasksChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listTasks(): Task[] {
  return sortTasks(read());
}

export function addTask(draft: TaskDraft): Task {
  const task = createTask(draft, new Date(), randomUUID());
  write([...read(), task]);
  return task;
}

export function patchTask(id: string, patch: TaskPatch): Task | null {
  const tasks = read();
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return null;

  const updated = applyPatch(tasks[index], patch, new Date());
  tasks[index] = updated;
  write(tasks);
  return updated;
}

export function removeTask(id: string): boolean {
  const tasks = read();
  const remaining = tasks.filter((task) => task.id !== id);
  if (remaining.length === tasks.length) return false;
  write(remaining);
  return true;
}

export function clearCompleted(): number {
  const tasks = read();
  const remaining = tasks.filter((task) => !task.done);
  const removed = tasks.length - remaining.length;
  if (removed > 0) write(remaining);
  return removed;
}

/** Stamps a reminder as announced so the scheduler never fires it twice. */
export function markTaskReminded(id: string): void {
  const tasks = read();
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return;
  tasks[index] = markReminded(tasks[index], new Date());
  write(tasks);
}
