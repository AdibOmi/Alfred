// Imported first by main.ts: a self-test run gets its own data folder, so it can never
// touch the real settings or session. Must run before electron-store is constructed.
import os from 'os';
import path from 'path';
import { app } from 'electron';

if (process.argv.includes('--selftest')) {
  app.setPath('userData', path.join(os.tmpdir(), `alfred-selftest-${Date.now()}`));
}
