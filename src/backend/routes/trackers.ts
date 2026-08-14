import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { Db } from '../db';
import { localDateString, startOfLocalDay } from '../../shared/date';

export type TrackerType = 'github' | 'leetcode' | 'manual';

interface TrackerRow {
  id: string;
  type: string;
  name: string;
  unit: string | null;
  position: number;
  enabled: number;
  created_at: string;
}

export interface Tracker {
  id: string;
  type: TrackerType;
  name: string;
  unit: string | null;
  position: number;
  enabled: boolean;
  created_at: string;
}

function toTracker(row: TrackerRow): Tracker {
  return { ...row, type: row.type as TrackerType, enabled: Boolean(row.enabled) };
}

const DEFAULT_NAME: Record<TrackerType, string> = { github: 'GitHub', leetcode: 'LeetCode', manual: '' };

export function trackersRouter(db: Db) {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT * FROM trackers ORDER BY position ASC').all() as TrackerRow[];
    res.json({ trackers: rows.map(toTracker) });
  });

  router.post('/', (req, res) => {
    const { type, name, unit } = req.body ?? {};
    if (type !== 'github' && type !== 'leetcode' && type !== 'manual') {
      return res.status(400).json({ error: 'type must be one of github, leetcode, manual' });
    }

    if (type !== 'manual') {
      const existing = db.prepare('SELECT id FROM trackers WHERE type = ?').get(type);
      if (existing) return res.status(409).json({ error: `A ${type} tracker already exists` });
    }

    const trimmedName = typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_NAME[type as TrackerType];
    if (!trimmedName) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { maxPosition } = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPosition FROM trackers').get() as {
      maxPosition: number;
    };

    const row: TrackerRow = {
      id: randomUUID(),
      type,
      name: trimmedName,
      unit: type === 'manual' && typeof unit === 'string' && unit.trim() ? unit.trim() : null,
      position: maxPosition + 1,
      enabled: 1,
      created_at: new Date().toISOString(),
    };
    db.prepare(
      'INSERT INTO trackers (id, type, name, unit, position, enabled, created_at) VALUES (@id, @type, @name, @unit, @position, @enabled, @created_at)',
    ).run(row);
    res.status(201).json({ tracker: toTracker(row) });
  });

  router.patch('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM trackers WHERE id = ?').get(req.params.id) as TrackerRow | undefined;
    if (!existing) return res.status(404).json({ error: 'tracker not found' });

    const { name, unit, enabled } = req.body ?? {};
    const updated: TrackerRow = {
      ...existing,
      name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
      unit: typeof unit === 'string' ? unit.trim() || null : existing.unit,
      enabled: typeof enabled === 'boolean' ? (enabled ? 1 : 0) : existing.enabled,
    };
    db.prepare('UPDATE trackers SET name = @name, unit = @unit, enabled = @enabled WHERE id = @id').run(updated);
    res.json({ tracker: toTracker(updated) });
  });

  router.post('/:id/move', (req, res) => {
    const { direction } = req.body ?? {};
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).json({ error: 'direction must be up or down' });
    }

    const rows = db.prepare('SELECT * FROM trackers ORDER BY position ASC').all() as TrackerRow[];
    const index = rows.findIndex((row) => row.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'tracker not found' });

    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex >= 0 && swapIndex < rows.length) {
      const a = rows[index];
      const b = rows[swapIndex];
      const swap = db.transaction(() => {
        db.prepare('UPDATE trackers SET position = ? WHERE id = ?').run(b.position, a.id);
        db.prepare('UPDATE trackers SET position = ? WHERE id = ?').run(a.position, b.id);
      });
      swap();
    }

    const updatedRows = db.prepare('SELECT * FROM trackers ORDER BY position ASC').all() as TrackerRow[];
    res.json({ trackers: updatedRows.map(toTracker) });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM trackers WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  router.get('/:id/logs', (req, res) => {
    const logs = db
      .prepare('SELECT * FROM tracker_logs WHERE tracker_id = ? ORDER BY date DESC, created_at DESC LIMIT 200')
      .all(req.params.id);
    res.json({ logs });
  });

  router.get('/:id/summary', (req, res) => {
    const logs = db
      .prepare('SELECT date, value FROM tracker_logs WHERE tracker_id = ? ORDER BY date DESC LIMIT 500')
      .all(req.params.id) as { date: string; value: number }[];

    const valueByDate = new Map<string, number>();
    for (const log of logs) {
      valueByDate.set(log.date, (valueByDate.get(log.date) ?? 0) + log.value);
    }

    const today = startOfLocalDay();
    const series: { date: string; value: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      const date = localDateString(day);
      series.push({ date, value: Math.round((valueByDate.get(date) ?? 0) * 100) / 100 });
    }

    let streak = 0;
    const cursor = new Date(today);
    // A day with no entry yet (e.g. "today, before logging") shouldn't break the streak.
    if (!valueByDate.has(localDateString(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (valueByDate.has(localDateString(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    res.json({ streak, series, totalEntries: logs.length });
  });

  router.post('/:id/logs', (req, res) => {
    const tracker = db.prepare('SELECT * FROM trackers WHERE id = ?').get(req.params.id) as TrackerRow | undefined;
    if (!tracker) return res.status(404).json({ error: 'tracker not found' });
    if (tracker.type !== 'manual') return res.status(400).json({ error: 'only manual trackers accept log entries' });

    const { date, label, value, notes } = req.body ?? {};
    if (typeof date !== 'string' || typeof value !== 'number' || Number.isNaN(value)) {
      return res.status(400).json({ error: 'date and value are required' });
    }
    const log = {
      id: randomUUID(),
      tracker_id: tracker.id,
      date,
      label: typeof label === 'string' && label.trim() ? label.trim() : null,
      value,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      created_at: new Date().toISOString(),
    };
    db.prepare(
      'INSERT INTO tracker_logs (id, tracker_id, date, label, value, notes, created_at) VALUES (@id, @tracker_id, @date, @label, @value, @notes, @created_at)',
    ).run(log);
    res.status(201).json({ log });
  });

  router.delete('/:id/logs/:logId', (req, res) => {
    db.prepare('DELETE FROM tracker_logs WHERE id = ? AND tracker_id = ?').run(req.params.logId, req.params.id);
    res.status(204).end();
  });

  return router;
}
