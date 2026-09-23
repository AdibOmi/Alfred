// Pure task/reminder logic, deliberately free of any Electron import so it can
// be unit-tested in a plain Node environment. Everything that touches disk or
// the OS lives in src/electron/taskStore.ts and src/electron/reminders.ts.

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  done: boolean;
  /** ISO-8601 timestamp. */
  createdAt: string;
  completedAt: string | null;
  /** ISO-8601 timestamp. A task with a remindAt is what the UI calls a reminder. */
  remindAt: string | null;
  /** Set once the reminder notification has actually been shown, so it fires once. */
  remindedAt: string | null;
}

export interface TaskDraft {
  title: string;
  notes?: string | null;
  remindAt?: string | null;
}

export interface TaskPatch {
  title?: string;
  notes?: string | null;
  remindAt?: string | null;
  done?: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates a date coming from Claude, the renderer, or a config file written
 * by an older build. Accepts anything `Date` understands; a bare
 * `2026-09-22T17:00:00` (no zone suffix) is read as local wall-clock time,
 * which is what "remind me at 5pm" means to a person.
 */
export function parseTimestamp(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Rebuilds a Task from untrusted JSON, dropping anything unusable. Returning
 * null (rather than throwing) means one corrupt entry can't take out the whole
 * task list on startup.
 */
export function normalizeTask(raw: unknown): Task | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.title)) return null;

  const done = candidate.done === true;
  return {
    id: candidate.id,
    title: candidate.title.trim(),
    notes: isNonEmptyString(candidate.notes) ? candidate.notes.trim() : null,
    done,
    createdAt: parseTimestamp(candidate.createdAt) ?? new Date(0).toISOString(),
    completedAt: done ? parseTimestamp(candidate.completedAt) : null,
    remindAt: parseTimestamp(candidate.remindAt),
    remindedAt: parseTimestamp(candidate.remindedAt),
  };
}

export function createTask(draft: TaskDraft, now: Date, id: string): Task {
  return {
    id,
    title: draft.title.trim(),
    notes: isNonEmptyString(draft.notes) ? draft.notes.trim() : null,
    done: false,
    createdAt: now.toISOString(),
    completedAt: null,
    remindAt: parseTimestamp(draft.remindAt),
    remindedAt: null,
  };
}

/**
 * Applies a partial edit. Moving a reminder to a new time clears remindedAt so
 * the rescheduled reminder fires again; completing a task stamps completedAt.
 */
export function applyPatch(task: Task, patch: TaskPatch, now: Date): Task {
  const next: Task = { ...task };

  if (isNonEmptyString(patch.title)) next.title = patch.title.trim();
  if (patch.notes !== undefined) next.notes = isNonEmptyString(patch.notes) ? patch.notes.trim() : null;

  if (patch.remindAt !== undefined) {
    const remindAt = parseTimestamp(patch.remindAt);
    if (remindAt !== next.remindAt) {
      next.remindAt = remindAt;
      next.remindedAt = null;
    }
  }

  if (patch.done !== undefined && patch.done !== next.done) {
    next.done = patch.done;
    next.completedAt = patch.done ? now.toISOString() : null;
  }

  return next;
}

export function markReminded(task: Task, now: Date): Task {
  return { ...task, remindedAt: now.toISOString() };
}

/**
 * Open tasks first (soonest reminder first, then unscheduled by age), completed
 * tasks last with the most recently finished on top.
 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;

    if (a.done && b.done) {
      return (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt);
    }

    if (a.remindAt && b.remindAt) return a.remindAt.localeCompare(b.remindAt);
    if (a.remindAt) return -1;
    if (b.remindAt) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * Reminders whose time has arrived and that haven't been announced yet. Past-due
 * reminders are included on purpose: if the app was closed when one came due,
 * the user should still be told the next time Alfred is running.
 */
export function dueReminders(tasks: Task[], now: Date): Task[] {
  const cutoff = now.getTime();
  return tasks.filter(
    (task) => !task.done && !task.remindedAt && task.remindAt !== null && new Date(task.remindAt).getTime() <= cutoff,
  );
}

export function openTaskCount(tasks: Task[]): number {
  return tasks.filter((task) => !task.done).length;
}

/** Open reminders that are already past due and still not completed. */
export function overdueCount(tasks: Task[], now: Date): number {
  const cutoff = now.getTime();
  return tasks.filter((task) => !task.done && task.remindAt !== null && new Date(task.remindAt).getTime() <= cutoff)
    .length;
}
