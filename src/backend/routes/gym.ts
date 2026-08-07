import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { Db } from '../db';
import { localDateString, startOfLocalDay } from '../../shared/date';

interface GymLog {
  id: string;
  date: string;
  exercise: string;
  sets: number;
  reps: number;
  weight: number | null;
  notes: string | null;
  created_at: string;
}

export function gymRouter(db: Db) {
  const router = Router();

  router.get('/', (_req, res) => {
    const logs = db.prepare('SELECT * FROM gym_logs ORDER BY date DESC, created_at DESC LIMIT 200').all();
    res.json({ logs });
  });

  router.get('/summary', (_req, res) => {
    const logs = db
      .prepare('SELECT date, sets, reps, weight FROM gym_logs ORDER BY date DESC LIMIT 500')
      .all() as Pick<GymLog, 'date' | 'sets' | 'reps' | 'weight'>[];

    const volumeByDate = new Map<string, number>();
    for (const log of logs) {
      const volume = log.sets * log.reps * (log.weight ?? 1);
      volumeByDate.set(log.date, (volumeByDate.get(log.date) ?? 0) + volume);
    }

    const today = startOfLocalDay();
    const weeklyVolume: { date: string; volume: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      const date = localDateString(day);
      weeklyVolume.push({ date, volume: Math.round(volumeByDate.get(date) ?? 0) });
    }

    let streak = 0;
    const cursor = new Date(today);
    // A day with no log yet (e.g. "today, before the gym") shouldn't break the streak.
    if (!volumeByDate.has(localDateString(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (volumeByDate.has(localDateString(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    res.json({ streak, weeklyVolume, totalEntries: logs.length });
  });

  router.post('/', (req, res) => {
    const { date, exercise, sets, reps, weight, notes } = req.body ?? {};
    if (typeof date !== 'string' || typeof exercise !== 'string' || !exercise.trim() || typeof sets !== 'number' || typeof reps !== 'number') {
      return res.status(400).json({ error: 'date, exercise, sets and reps are required' });
    }
    const log: GymLog = {
      id: randomUUID(),
      date,
      exercise: exercise.trim(),
      sets,
      reps,
      weight: typeof weight === 'number' ? weight : null,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      created_at: new Date().toISOString(),
    };
    db.prepare(
      'INSERT INTO gym_logs (id, date, exercise, sets, reps, weight, notes, created_at) VALUES (@id, @date, @exercise, @sets, @reps, @weight, @notes, @created_at)',
    ).run(log);
    res.status(201).json({ log });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM gym_logs WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  return router;
}
