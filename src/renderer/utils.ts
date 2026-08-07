export type Urgency = 'overdue' | 'urgent' | 'soon' | 'later';

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
