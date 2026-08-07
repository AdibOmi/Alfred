import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      due TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      notified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gym_logs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      exercise TEXT NOT NULL,
      sets INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      weight REAL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
    CREATE INDEX IF NOT EXISTS idx_gym_logs_date ON gym_logs(date);
  `);

  return db;
}

export interface DueTask {
  id: string;
  title: string;
  due: string;
}

export function getPendingNotifications(db: Db, lookaheadMinutes: number): DueTask[] {
  const horizon = new Date(Date.now() + lookaheadMinutes * 60 * 1000).toISOString();
  return db
    .prepare("SELECT id, title, due FROM tasks WHERE status = 'active' AND notified_at IS NULL AND due <= ?")
    .all(horizon) as DueTask[];
}

export function markNotified(db: Db, id: string) {
  db.prepare('UPDATE tasks SET notified_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}
