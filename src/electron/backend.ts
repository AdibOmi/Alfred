// Starts Alfred's own backend when it points at this machine and nothing is answering there, so
// one `npm start` is the whole setup. A remote server, or one already running, is left alone.
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { app } from 'electron';

const HEALTH_TIMEOUT_MS = 1500;
const STARTUP_LIMIT_MS = 30_000;

let child: ChildProcess | null = null;
let ready: Promise<void> = Promise.resolve();

async function healthy(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

function isLocal(base: string): URL | null {
  try {
    const url = new URL(base);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function backendDir(): string | null {
  const candidates = [
    path.join(__dirname, '..', '..', 'backend'), // dev, from src/electron or dist/electron
    path.join(app.getAppPath(), 'backend'),
    path.join(process.resourcesPath ?? '', 'backend'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'run.py'))) ?? null;
}

/** The venv made by `npm run setup` when there is one, otherwise whatever Python is on PATH. */
function pythonIn(dir: string): string {
  const venv =
    process.platform === 'win32'
      ? path.join(dir, '.venv', 'Scripts', 'python.exe')
      : path.join(dir, '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Makes sure a local backend is up, starting one if needed. Never throws: if it can't start,
 * requests fail with the usual "can't reach its server" message, which says what to do.
 */
export function ensureBackend(base: string): Promise<void> {
  ready = (async () => {
    const url = isLocal(base);
    if (!url || (await healthy(base))) return;

    const dir = backendDir();
    if (!dir) return;

    const python = pythonIn(dir);
    console.log(`[alfred] starting the backend: ${python} run.py (in ${dir})`);
    child = spawn(python, ['run.py'], {
      cwd: dir,
      env: { ...process.env, PORT: url.port || '8000', PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });
    child.stdout?.on('data', (chunk) => process.stdout.write(`[backend] ${chunk}`));
    child.stderr?.on('data', (chunk) => process.stdout.write(`[backend] ${chunk}`));
    child.on('error', (error) => console.warn(`[alfred] could not start the backend: ${error.message}`));
    child.on('exit', (code) => {
      if (code) console.warn(`[alfred] the backend exited with code ${code}. Run \`npm run setup\` if its packages are missing.`);
      child = null;
    });

    const deadline = Date.now() + STARTUP_LIMIT_MS;
    while (child && Date.now() < deadline) {
      if (await healthy(base)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return ready;
}

/** Resolves once any backend start-up in progress has finished (or given up). */
export function whenBackendReady(): Promise<void> {
  return ready;
}

export function stopBackend() {
  if (!child) return;
  child.kill();
  child = null;
}
