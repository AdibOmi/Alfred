export type Urgency = 'overdue' | 'urgent' | 'soon' | 'later';

// Dated items sort chronologically to the front; undated ones follow, oldest-created first.
// Works for both deadlines (long-span, may or may not have a date) and to-dos (may have a
// same-day time attached) since both buckets share this "date first, else creation order" rule.
export function sortByDueThenCreated<T extends { due: string | null; created_at: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function getUrgency(due: string): Urgency {
  const diffMs = new Date(due).getTime() - Date.now();
  if (diffMs < 0) return 'overdue';
  if (diffMs < 24 * 60 * 60 * 1000) return 'urgent';
  if (diffMs < 3 * 24 * 60 * 60 * 1000) return 'soon';
  return 'later';
}

export function formatDue(due: string): string {
  return new Date(due).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function computeDailyStreak(days: { date: string; count: number }[]): number {
  if (!days.length) return 0;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let idx = sorted.length - 1;
  const todayStr = new Date().toISOString().slice(0, 10);
  if (sorted[idx].date === todayStr && sorted[idx].count === 0) {
    idx -= 1;
  }
  let streak = 0;
  for (; idx >= 0; idx -= 1) {
    if (sorted[idx].count > 0) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
