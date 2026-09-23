import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  createTask,
  dueReminders,
  markReminded,
  normalizeTask,
  openTaskCount,
  overdueCount,
  parseTimestamp,
  sortTasks,
  type Task,
} from './tasks';

const NOW = new Date(2026, 8, 22, 12, 0, 0); // 22 Sep 2026, noon, local time

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'id-1',
    title: 'Call the dentist',
    notes: null,
    done: false,
    createdAt: new Date(2026, 8, 20, 9, 0, 0).toISOString(),
    completedAt: null,
    remindAt: null,
    remindedAt: null,
    ...overrides,
  };
}

describe('parseTimestamp', () => {
  it('reads a bare date-time as local wall-clock time', () => {
    const parsed = parseTimestamp('2026-09-22T17:00:00');
    expect(parsed).not.toBeNull();
    expect(new Date(parsed as string).getHours()).toBe(17);
  });

  it('rejects junk and empty values', () => {
    expect(parseTimestamp('next thursday-ish')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(42)).toBeNull();
  });
});

describe('normalizeTask', () => {
  it('rebuilds a well-formed task from plain JSON', () => {
    const restored = normalizeTask({
      id: 'abc',
      title: '  Buy milk  ',
      done: false,
      createdAt: '2026-09-20T09:00:00.000Z',
    });
    expect(restored?.title).toBe('Buy milk');
    expect(restored?.notes).toBeNull();
  });

  it('drops entries with no id or no title instead of throwing', () => {
    expect(normalizeTask({ title: 'orphan' })).toBeNull();
    expect(normalizeTask({ id: 'abc', title: '   ' })).toBeNull();
    expect(normalizeTask(null)).toBeNull();
    expect(normalizeTask('not a task')).toBeNull();
  });

  it('discards a completedAt left on a task that is not done', () => {
    const restored = normalizeTask({ id: 'abc', title: 'Thing', done: false, completedAt: '2026-09-21T10:00:00Z' });
    expect(restored?.completedAt).toBeNull();
  });
});

describe('createTask', () => {
  it('starts open, unreminded, and stamped with the current time', () => {
    const created = createTask({ title: 'Submit form' }, NOW, 'generated-id');
    expect(created).toMatchObject({ id: 'generated-id', title: 'Submit form', done: false, remindedAt: null });
    expect(created.createdAt).toBe(NOW.toISOString());
  });

  it('keeps a reminder time when one is supplied', () => {
    const created = createTask({ title: 'Standup', remindAt: '2026-09-23T09:30:00' }, NOW, 'x');
    expect(new Date(created.remindAt as string).getHours()).toBe(9);
  });
});

describe('applyPatch', () => {
  it('stamps completedAt when a task is completed and clears it when reopened', () => {
    const completed = applyPatch(task(), { done: true }, NOW);
    expect(completed.completedAt).toBe(NOW.toISOString());

    const reopened = applyPatch(completed, { done: false }, NOW);
    expect(reopened.completedAt).toBeNull();
  });

  it('re-arms a reminder that has already fired when the time changes', () => {
    const fired = task({ remindAt: new Date(2026, 8, 22, 9, 0, 0).toISOString(), remindedAt: NOW.toISOString() });
    const moved = applyPatch(fired, { remindAt: '2026-09-22T18:00:00' }, NOW);
    expect(moved.remindedAt).toBeNull();
  });

  it('leaves remindedAt alone when the patch does not move the time', () => {
    const fired = task({ remindAt: new Date(2026, 8, 22, 9, 0, 0).toISOString(), remindedAt: NOW.toISOString() });
    const renamed = applyPatch(fired, { title: 'New title' }, NOW);
    expect(renamed.remindedAt).toBe(fired.remindedAt);
  });

  it('clears a reminder when remindAt is set to null', () => {
    const scheduled = task({ remindAt: new Date(2026, 8, 25, 9, 0, 0).toISOString() });
    expect(applyPatch(scheduled, { remindAt: null }, NOW).remindAt).toBeNull();
  });
});

describe('sortTasks', () => {
  it('puts open tasks first, soonest reminder first, and finished tasks last', () => {
    const sorted = sortTasks([
      task({ id: 'done', done: true, completedAt: NOW.toISOString() }),
      task({ id: 'no-reminder' }),
      task({ id: 'later', remindAt: new Date(2026, 8, 24, 9, 0, 0).toISOString() }),
      task({ id: 'sooner', remindAt: new Date(2026, 8, 22, 14, 0, 0).toISOString() }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['sooner', 'later', 'no-reminder', 'done']);
  });
});

describe('dueReminders', () => {
  const overdue = task({ id: 'overdue', remindAt: new Date(2026, 8, 22, 11, 0, 0).toISOString() });
  const future = task({ id: 'future', remindAt: new Date(2026, 8, 22, 18, 0, 0).toISOString() });

  it('returns reminders whose time has passed', () => {
    expect(dueReminders([overdue, future], NOW).map((entry) => entry.id)).toEqual(['overdue']);
  });

  it('ignores reminders that already fired', () => {
    expect(dueReminders([markReminded(overdue, NOW)], NOW)).toEqual([]);
  });

  it('ignores completed tasks and plain to-dos with no reminder', () => {
    expect(dueReminders([{ ...overdue, done: true }, task({ id: 'plain' })], NOW)).toEqual([]);
  });

  it('still surfaces a reminder that came due while the app was closed', () => {
    const missedYesterday = task({ id: 'missed', remindAt: new Date(2026, 8, 21, 8, 0, 0).toISOString() });
    expect(dueReminders([missedYesterday], NOW).map((entry) => entry.id)).toEqual(['missed']);
  });
});

describe('counts', () => {
  it('counts open tasks and, separately, open reminders already past due', () => {
    const tasks = [
      task({ id: 'a', remindAt: new Date(2026, 8, 22, 11, 0, 0).toISOString() }),
      task({ id: 'b', remindAt: new Date(2026, 8, 23, 11, 0, 0).toISOString() }),
      task({ id: 'c' }),
      task({ id: 'd', done: true }),
    ];
    expect(openTaskCount(tasks)).toBe(3);
    expect(overdueCount(tasks, NOW)).toBe(1);
  });
});
