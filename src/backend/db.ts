import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const trackersTableExisted = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trackers'").get(),
  );

  db.exec(`
    -- due is nullable: a task can be scheduled or not, independent of its kind.
    -- kind distinguishes a longer-span deadline (project, assignment, goal) from a
    -- small day-to-day to-do; either can carry a due date or go undated.
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      due TEXT,
      kind TEXT NOT NULL DEFAULT 'todo',
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

    -- Superseded by trackers/tracker_logs (see migrateLegacyGymLogs), kept only so
    -- existing on-disk data survives; no route reads/writes this table anymore.
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

    -- A tracker is a user-configurable dashboard widget: the built-in 'github' and
    -- 'leetcode' integrations, or a free-form 'manual' log (name + unit chosen by the user).
    CREATE TABLE IF NOT EXISTS trackers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT,
      position INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracker_logs (
      id TEXT PRIMARY KEY,
      tracker_id TEXT NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      label TEXT,
      value REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
    CREATE INDEX IF NOT EXISTS idx_gym_logs_date ON gym_logs(date);
    CREATE INDEX IF NOT EXISTS idx_tracker_logs_tracker_date ON tracker_logs(tracker_id, date);
  `);

  migrateTasksDueNullable(db);
  migrateTasksAddKind(db);

  if (!trackersTableExisted) {
    migrateLegacyGymLogs(db);
  }

  return db;
}

// Existing databases were created with `due TEXT NOT NULL`; SQLite can't drop a
// column constraint in place, so rebuild the table once, then leave it alone
// (cheap PRAGMA check on every later startup makes this a no-op after that).
function migrateTasksDueNullable(db: Db) {
  const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string; notnull: number }[];
  const dueColumn = columns.find((column) => column.name === 'due');
  if (!dueColumn || dueColumn.notnull === 0) return;

  db.transaction(() => {
    db.exec(`
      CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT,
        due TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        notified_at TEXT
      );
      INSERT INTO tasks_new SELECT id, title, notes, due, status, created_at, notified_at FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
    `);
  })();
}

// Existing databases predate the kind column; backfill it from the old due-based
// convention (dated -> deadline, undated -> to-do) so history reads the same as before.
function migrateTasksAddKind(db: Db) {
  const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  if (columns.some((column) => column.name === 'kind')) return;

  db.transaction(() => {
    db.exec("ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'todo'");
    db.exec("UPDATE tasks SET kind = 'deadline' WHERE due IS NOT NULL");
  })();
}

// First-run only, and only if pre-existing gym_logs rows exist (from before trackers
// existed): carries that data forward as a "Gym" manual tracker so it isn't lost.
// Fresh installs get zero trackers — the user adds whatever they want to track.
function migrateLegacyGymLogs(db: Db) {
  const legacyGymLogs = db.prepare('SELECT * FROM gym_logs').all() as {
    id: string;
    date: string;
    exercise: string;
    sets: number;
    reps: number;
    weight: number | null;
    notes: string | null;
    created_at: string;
  }[];

  if (legacyGymLogs.length === 0) return;

  const now = new Date().toISOString();
  const gymTrackerId = randomUUID();
  db.prepare(
    'INSERT INTO trackers (id, type, name, unit, position, enabled, created_at) VALUES (@id, @type, @name, @unit, @position, 1, @created_at)',
  ).run({ id: gymTrackerId, type: 'manual', name: 'Gym', unit: 'volume', position: 0, created_at: now });

  const insertLog = db.prepare(
    'INSERT INTO tracker_logs (id, tracker_id, date, label, value, notes, created_at) VALUES (@id, @tracker_id, @date, @label, @value, @notes, @created_at)',
  );
  const migrate = db.transaction((logs: typeof legacyGymLogs) => {
    for (const log of logs) {
      const detail = `${log.sets}×${log.reps}${log.weight ? ` @ ${log.weight}` : ''}`;
      insertLog.run({
        id: randomUUID(),
        tracker_id: gymTrackerId,
        date: log.date,
        label: log.exercise,
        value: log.sets * log.reps * (log.weight ?? 1),
        notes: [detail, log.notes].filter(Boolean).join(' — '),
        created_at: log.created_at,
      });
    }
  });
  migrate(legacyGymLogs);
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
