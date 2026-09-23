import { app, globalShortcut, ipcMain, session, shell } from 'electron';
import isDev from 'electron-is-dev';
import { createFloatingWindow, type AlfredWindow } from './window';
import { applyAutoLaunch } from './autoLaunch';
import { checkScreenPermission } from './capture';
import { AskError, ask } from './agent';
import { startReminderScheduler, type ReminderScheduler } from './reminders';
import { addTask, clearCompleted, listTasks, onTasksChanged, patchTask, removeTask } from './taskStore';
import type { TaskDraft, TaskPatch } from '../shared/tasks';
import type { ChatTurn } from '../shared/history';
import { clearApiKey, getApiKey, getAutoLaunch, hasApiKey, setApiKey, setAutoLaunchPref } from './store';

let alfred: AlfredWindow | null = null;
let scheduler: ReminderScheduler | null = null;

const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+A';
const PRODUCTION_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';";

// A CSP is only applied in production: the Vite dev server needs eval() for HMR
// and serves from a different origin, so a strict policy would break `npm start`.
function applyProductionCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [PRODUCTION_CSP] } });
  });
}

type AskResult =
  | { ok: true; reply: string; usedScreen: boolean }
  | { ok: false; code: 'no-api-key' | 'permission-denied' | 'api-error'; message: string };

function registerIpcHandlers(window: AlfredWindow) {
  ipcMain.handle('alfred:getState', () => ({
    hasApiKey: hasApiKey(),
    autoLaunch: getAutoLaunch(),
  }));

  ipcMain.handle('alfred:setApiKey', (_event, key: string) => {
    setApiKey(key);
  });

  ipcMain.handle('alfred:clearApiKey', () => {
    clearApiKey();
  });

  ipcMain.handle('alfred:setAutoLaunch', (_event, enabled: boolean) => {
    setAutoLaunchPref(enabled);
    applyAutoLaunch(enabled);
  });

  ipcMain.handle('alfred:resetIconPosition', () => {
    window.resetPosition();
  });

  ipcMain.handle('alfred:setExpanded', (_event, expanded: boolean) => {
    if (expanded) window.expand();
    else window.collapse();
  });

  ipcMain.handle('alfred:checkScreenPermission', () => checkScreenPermission());

  ipcMain.handle('alfred:openScreenPermissionSettings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
  });

  ipcMain.handle('alfred:listTasks', () => listTasks());

  ipcMain.handle('alfred:createTask', (_event, draft: TaskDraft) => {
    const task = addTask(draft);
    // A task added by hand may already be due, so sweep rather than waiting out
    // the rest of the current interval.
    scheduler?.sweep();
    return task;
  });

  ipcMain.handle('alfred:updateTask', (_event, id: string, patch: TaskPatch) => {
    const task = patchTask(id, patch);
    scheduler?.sweep();
    return task;
  });

  ipcMain.handle('alfred:deleteTask', (_event, id: string) => removeTask(id));

  ipcMain.handle('alfred:clearCompletedTasks', () => clearCompleted());

  ipcMain.handle('alfred:ask', async (_event, question: string, history: ChatTurn[] = []): Promise<AskResult> => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { ok: false, code: 'no-api-key', message: 'No API key configured yet.' };
    }

    try {
      const outcome = await ask(question, history, apiKey);
      if (outcome.changedTasks) scheduler?.sweep();
      return { ok: true, reply: outcome.reply, usedScreen: outcome.usedScreen };
    } catch (error) {
      if (error instanceof AskError) return { ok: false, code: error.code, message: error.message };
      return { ok: false, code: 'api-error', message: (error as Error).message || 'Something went wrong.' };
    }
  });
}

// Two copies of Alfred would mean two tray icons and, worse, two reminder
// schedulers racing to announce the same reminder twice.
const gotTheLock = app.requestSingleInstanceLock();

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
    applyAutoLaunch(getAutoLaunch());
    registerIpcHandlers(alfred);

    onTasksChanged((tasks) => {
      if (alfred && !alfred.window.isDestroyed()) alfred.window.webContents.send('alfred:tasks-changed', tasks);
    });

    scheduler = startReminderScheduler(() => {
      alfred?.window.show();
      alfred?.expand();
      alfred?.window.webContents.send('alfred:show-view', 'tasks');
    });

    const registered = globalShortcut.register(TOGGLE_SHORTCUT, () => alfred?.toggle());
    if (!registered) {
      // Another app already owns the chord. The tray icon and the floating
      // icon both still work, so this is a downgrade, not a failure.
      console.warn(`Could not register the ${TOGGLE_SHORTCUT} shortcut; it is already taken.`);
    }

    app.on('activate', () => {
      if (!alfred?.window.isVisible()) alfred?.window.show();
    });
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  scheduler?.stop();
});

app.on('window-all-closed', () => {
  // The floating window hides on blur but is never destroyed while the app is
  // running (quitting only ever happens via the tray's Quit item), so this only
  // fires on an actual app.quit() — always safe to let quit proceed here.
  if (process.platform !== 'darwin') app.quit();
});
