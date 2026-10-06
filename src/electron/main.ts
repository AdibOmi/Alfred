import './selftestPath';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app, globalShortcut, ipcMain, session, shell } from 'electron';
import isDev from 'electron-is-dev';
import { createFloatingWindow, type AlfredWindow } from './window';
import { applyAutoLaunch } from './autoLaunch';
import { checkScreenPermission } from './capture';
import { ApiError, api, localTimeWithOffset } from './api';
import { createOverlay } from './overlay';
import { createGuide, type Guide } from './guide';
import { cursorMoveSupported, disposeCursor, warmUpCursor } from './cursor';
import { runSelftest } from './selftest';
import { startReminderScheduler, type ReminderScheduler } from './reminders';
import {
  addTask,
  clearCompleted,
  forgetTasks,
  listTasks,
  onTasksChanged,
  patchTask,
  refreshTasks,
  removeTask,
} from './taskStore';
import type { TaskDraft, TaskPatch } from '../shared/tasks';
import { trimHistory, type ChatTurn } from '../shared/history';
import {
  clearSession,
  getApiBase,
  getAutoLaunch,
  getMoveRealCursor,
  getUser,
  setApiBase,
  setAutoLaunchPref,
  setMoveRealCursor,
  setSession,
  setUser,
} from './store';

let alfred: AlfredWindow | null = null;
let scheduler: ReminderScheduler | null = null;
let guide: Guide | null = null;

const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+A';
const PRODUCTION_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';";
const MAX_HISTORY_TURNS = 8;

// A CSP is only applied in production: the Vite dev server needs eval() for HMR
// and serves from a different origin, so a strict policy would break `npm start`.
function applyProductionCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [PRODUCTION_CSP] } });
  });
}

export type ErrorCode = 'signed-out' | 'permission-denied' | 'api-error';
type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };

function signOut() {
  clearSession();
  forgetTasks();
  guide?.reset();
}

/** Wraps an IPC handler so every failure reaches the renderer as a readable message. */
function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signOut();
        return { ok: false, code: 'signed-out', message: 'Please sign in again.' };
      }
      if ((error as { code?: string }).code === 'permission-denied') {
        return { ok: false, code: 'permission-denied', message: (error as Error).message };
      }
      return { ok: false, code: 'api-error', message: (error as Error).message || 'Something went wrong.' };
    }
  });
}

function appState() {
  return {
    user: getUser(),
    apiBase: getApiBase(),
    autoLaunch: getAutoLaunch(),
    moveRealCursor: getMoveRealCursor(),
    canMoveCursor: cursorMoveSupported(),
    guide: guide?.state() ?? { active: false, goal: null, last: null },
  };
}

export type AppState = ReturnType<typeof appState>;

function requireScreenPermission() {
  const permission = checkScreenPermission();
  if (permission === 'denied' || permission === 'not-determined') {
    throw Object.assign(new Error('Alfred needs Screen Recording permission to see what you are looking at.'), {
      code: 'permission-denied',
    });
  }
}

function registerIpcHandlers(window: AlfredWindow) {
  ipcMain.handle('alfred:getState', () => appState());

  // ---- account
  handle('alfred:signup', async (name: string, email: string, password: string) => {
    const res = await api.signup(name, email, password);
    setSession(res.access_token, res.user);
    await refreshTasks();
    return appState();
  });
  handle('alfred:login', async (email: string, password: string) => {
    const res = await api.login(email, password);
    setSession(res.access_token, res.user);
    await refreshTasks();
    return appState();
  });
  handle('alfred:logout', async () => {
    signOut();
    return appState();
  });

  // ---- settings
  handle('alfred:setApiBase', async (url: string) => {
    if (!/^https?:\/\/\S+$/.test(url.trim())) throw new Error('The server URL must start with http:// or https://');
    setApiBase(url);
    return appState();
  });
  handle('alfred:setAutoLaunch', async (enabled: boolean) => {
    setAutoLaunchPref(enabled);
    applyAutoLaunch(enabled);
    return appState();
  });
  handle('alfred:setMoveRealCursor', async (enabled: boolean) => {
    setMoveRealCursor(enabled);
    if (enabled) warmUpCursor();
    return appState();
  });
  handle('alfred:setWeeklyReport', async (enabled: boolean) => {
    setUser(await api.updateMe({ weekly_report: enabled }));
    return appState();
  });

  ipcMain.handle('alfred:resetIconPosition', () => window.resetPosition());
  ipcMain.on('alfred:iconDragStart', () => window.beginDrag());
  ipcMain.on('alfred:iconDragMove', (_event, dx: number, dy: number) => window.dragBy(dx, dy));
  ipcMain.on('alfred:iconDragEnd', () => window.endDrag());
  ipcMain.handle('alfred:setExpanded', (_event, expanded: boolean) => (expanded ? window.expand() : window.collapse()));
  ipcMain.handle('alfred:checkScreenPermission', () => checkScreenPermission());
  ipcMain.handle('alfred:openScreenPermissionSettings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
  });

  // ---- tasks (stored on the server, mirrored locally for the reminder sweep)
  ipcMain.handle('alfred:listTasks', () => listTasks());
  handle('alfred:refreshTasks', () => refreshTasks());
  handle('alfred:createTask', async (draft: TaskDraft) => {
    const task = await addTask(draft);
    // A task added by hand may already be due, so sweep rather than waiting out the interval.
    scheduler?.sweep();
    return task;
  });
  handle('alfred:updateTask', async (id: string, patch: TaskPatch) => {
    const task = await patchTask(id, patch);
    scheduler?.sweep();
    return task;
  });
  handle('alfred:deleteTask', (id: string) => removeTask(id));
  handle('alfred:clearCompletedTasks', () => clearCompleted());

  // ---- the Ask box
  handle('alfred:ask', async (question: string, history: ChatTurn[] = []) => {
    const res = await api.chat(question, trimHistory(history, MAX_HISTORY_TURNS), localTimeWithOffset());
    if (res.changed_tasks) {
      await refreshTasks();
      scheduler?.sweep();
    }
    if (!res.look_at_screen) return { reply: res.reply, usedScreen: false, guide: null };

    // A screen question: take one screenshot now and start a guided session.
    requireScreenPermission();
    const step = await guide!.start(res.look_at_screen.goal);
    return { reply: step.reply || res.reply, usedScreen: true, guide: step };
  });

  // ---- guided steps
  handle('alfred:guideNext', async (message: string | null, completed: boolean) => {
    requireScreenPermission();
    return guide!.next(message, completed);
  });
  handle('alfred:guideReplay', async () => guide!.replay());
  handle('alfred:guideFinish', async (status: 'solved' | 'abandoned') => guide!.finish(status));

  // ---- history & reports
  handle('alfred:history', async () => {
    const [sessions, stats] = await Promise.all([api.listSessions(), api.stats()]);
    return { sessions, stats };
  });
  handle('alfred:session', (id: number) => api.getSession(id));
  handle('alfred:openReport', async () => {
    const file = path.join(os.tmpdir(), `alfred-weekly-report-${Date.now()}.pdf`);
    fs.writeFileSync(file, await api.weeklyPdf());
    const error = await shell.openPath(file);
    if (error) throw new Error(`Saved the report to ${file} but could not open it: ${error}`);
    return file;
  });
  handle('alfred:emailReport', () => api.emailReport());
}

// Two copies of Alfred would mean two tray icons and, worse, two reminder
// schedulers racing to announce the same reminder twice.
const gotTheLock = app.requestSingleInstanceLock();
const selftest = process.argv.includes('--selftest');

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    alfred?.window.show();
    alfred?.expand();
  });

  app.whenReady().then(() => {
    // Windows attributes notifications by AppUserModelID; without this, toasts
    // raised from a dev run are silently dropped by the OS.
    if (process.platform === 'win32') app.setAppUserModelId('dev.alfred.assistant');

    if (!isDev) applyProductionCsp();

    alfred = createFloatingWindow();
    const overlay = createOverlay();
    guide = createGuide(alfred, overlay, getMoveRealCursor);
    applyAutoLaunch(getAutoLaunch());
    registerIpcHandlers(alfred);
    if (getMoveRealCursor()) warmUpCursor();

    onTasksChanged((tasks) => {
      if (alfred && !alfred.window.isDestroyed()) alfred.window.webContents.send('alfred:tasks-changed', tasks);
    });

    scheduler = startReminderScheduler(() => alfred?.showView('tasks'));

    const registered = globalShortcut.register(TOGGLE_SHORTCUT, () => alfred?.toggle());
    if (!registered) {
      // Another app already owns the chord. The tray icon and the floating
      // icon both still work, so this is a downgrade, not a failure.
      console.warn(`Could not register the ${TOGGLE_SHORTCUT} shortcut; it is already taken.`);
    }

    if (selftest) {
      void runSelftest(alfred, overlay);
    }

    app.on('activate', () => {
      if (!alfred?.window.isVisible()) alfred?.window.show();
    });
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  scheduler?.stop();
  disposeCursor();
});

app.on('window-all-closed', () => {
  // The floating window hides on blur but is never destroyed while the app is
  // running (quitting only ever happens via the tray's Quit item), so this only
  // fires on an actual app.quit() — always safe to let quit proceed here.
  if (process.platform !== 'darwin') app.quit();
});
