import { describe, expect, it } from 'vitest';
import { calendarDayOffset, describeDue, toDateTimeLocalValue } from './format';

const NOW = new Date(2026, 8, 22, 12, 0, 0); // Tue 22 Sep 2026, noon, local time

function localIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month, day, hour, minute, 0).toISOString();
}

describe('calendarDayOffset', () => {
  it('counts whole calendar days, not elapsed hours', () => {
    // 11pm tonight and 1am tomorrow are two hours apart but different days.
    expect(calendarDayOffset(new Date(2026, 8, 22, 23, 0, 0), NOW)).toBe(0);
    expect(calendarDayOffset(new Date(2026, 8, 23, 1, 0, 0), NOW)).toBe(1);
  });

  it('handles month boundaries', () => {
    expect(calendarDayOffset(new Date(2026, 9, 1, 9, 0, 0), new Date(2026, 8, 30, 9, 0, 0))).toBe(1);
  });
});

describe('describeDue', () => {
  it('buckets an already-passed reminder as overdue', () => {
    expect(describeDue(localIso(2026, 8, 22, 9), NOW).kind).toBe('overdue');
  });

  it('buckets later today, tomorrow, this week, and beyond', () => {
    expect(describeDue(localIso(2026, 8, 22, 17), NOW).kind).toBe('today');
    expect(describeDue(localIso(2026, 8, 23, 9), NOW).kind).toBe('tomorrow');
    expect(describeDue(localIso(2026, 8, 25, 9), NOW).kind).toBe('thisWeek');
    expect(describeDue(localIso(2026, 9, 15, 9), NOW).kind).toBe('later');
  });

  it('degrades quietly on an unparseable timestamp', () => {
    expect(describeDue('sometime soon', NOW)).toEqual({ kind: 'later', label: '' });
  });
});

describe('toDateTimeLocalValue', () => {
  it('renders local wall-clock time, not the UTC instant', () => {
    // The regression this guards: using toISOString() here would show the user
    // a different hour than the one their reminder actually fires at.
    expect(toDateTimeLocalValue(localIso(2026, 8, 22, 17, 30))).toBe('2026-09-22T17:30');
  });

  it('returns an empty string for no reminder or an unparseable one', () => {
    expect(toDateTimeLocalValue(null)).toBe('');
    expect(toDateTimeLocalValue('whenever')).toBe('');
  });
});
