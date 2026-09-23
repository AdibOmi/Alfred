// Pure presentation helpers for reminder times. Kept free of React and Electron
// so the day-bucketing rules can be unit-tested directly.

export type DueKind = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later';

export interface DueDescription {
  kind: DueKind;
  /** Short human label for the panel, e.g. "Today 5:00 PM". */
  label: string;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from now's day to target's day: 0 today, 1 tomorrow. */
export function calendarDayOffset(target: Date, now: Date): number {
  return Math.round((startOfDay(target) - startOfDay(now)) / DAY_MS);
}

export function describeDue(remindAt: string, now: Date): DueDescription {
  const target = new Date(remindAt);
  if (Number.isNaN(target.getTime())) return { kind: 'later', label: '' };

  const time = target.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  // Past due is its own bucket regardless of which day it landed on — an
  // overdue reminder should read as overdue, not as "Today 9:00 AM".
  if (target.getTime() <= now.getTime()) {
    const offset = calendarDayOffset(target, now);
    return {
      kind: 'overdue',
      label: offset === 0 ? `Overdue ${time}` : `Overdue ${target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    };
  }

  const offset = calendarDayOffset(target, now);
  if (offset === 0) return { kind: 'today', label: `Today ${time}` };
  if (offset === 1) return { kind: 'tomorrow', label: `Tomorrow ${time}` };
  if (offset < 7) {
    return { kind: 'thisWeek', label: `${target.toLocaleDateString(undefined, { weekday: 'short' })} ${time}` };
  }
  return {
    kind: 'later',
    label: `${target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Formats a timestamp for an <input type="datetime-local">, which expects local
 * wall-clock time with no zone. Going through toISOString() here would shift the
 * value by the UTC offset and silently show the user the wrong hour.
 */
export function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
