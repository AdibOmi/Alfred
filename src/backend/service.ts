import path from 'path';
import express from 'express';
import cors from 'cors';
import { openDatabase, type Db } from './db';
import { loadEnv, getConfig } from './config';
import { tasksRouter } from './routes/tasks';
import { searchRouter } from './routes/search';
import { chatRouter } from './routes/chat';
import { githubRouter } from './routes/github';
import { leetcodeRouter } from './routes/leetcode';
import { gymRouter } from './routes/gym';
import { settingsRouter } from './routes/settings';
import { BACKEND_PORT } from '../shared/constants';

export interface BackendHandle {
  db: Db;
  close: () => void;
}

export function startBackend(userDataPath: string): BackendHandle {
  loadEnv(userDataPath);
  const config = getConfig();

  const db = openDatabase(path.join(userDataPath, 'alfred.db'));

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/tasks', tasksRouter(db, config.anthropicApiKey));
  app.use('/api/search', searchRouter());
  app.use('/api/chat', chatRouter(db, config.anthropicApiKey));
  app.use('/api/progress/github', githubRouter(() => getConfig().githubUsername, () => getConfig().githubToken));
  app.use('/api/progress/leetcode', leetcodeRouter(() => getConfig().leetcodeUsername));
  app.use('/api/gym', gymRouter(db));
  app.use('/api/settings', settingsRouter());

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Backend error:', err);
    res.status(500).json({ error: 'internal server error' });
  });

  const server = app.listen(BACKEND_PORT, '127.0.0.1', () => {
    console.log(`Alfred backend listening on http://127.0.0.1:${BACKEND_PORT}`);
  });

  return {
    db,
    close: () => {
      server.close();
      db.close();
    },
  };
}

// Allows the backend to be run and smoke-tested standalone: `tsx src/backend/service.ts`.
if (require.main === module) {
  const devUserData = path.join(__dirname, '..', '..', '.dev-data');
  startBackend(devUserData);
}
