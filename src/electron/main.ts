import { app, ipcMain, session, shell } from 'electron';
import isDev from 'electron-is-dev';
import { createFloatingWindow, type AlfredWindow } from './window';
import { applyAutoLaunch } from './autoLaunch';
import { checkScreenPermission } from './capture';
import { AskError, askAboutScreen } from './vision';
import { clearApiKey, getApiKey, getAutoLaunch, hasApiKey, setApiKey, setAutoLaunchPref } from './store';

let alfred: AlfredWindow | null = null;

const PRODUCTION_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';";

// A CSP is only applied in production: the Vite dev server needs eval() for HMR
// and serves from a different origin, so a strict policy would break `npm start`.
function applyProductionCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [PRODUCTION_CSP] } });
  });
}

type AskResult = { ok: true; reply: string } | { ok: false; code: 'no-api-key' | 'permission-denied' | 'api-error'; message: string };

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

  ipcMain.handle('alfred:ask', async (_event, question: string): Promise<AskResult> => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { ok: false, code: 'no-api-key', message: 'No API key configured yet.' };
    }

    const permission = checkScreenPermission();
    if (permission === 'denied' || permission === 'not-determined') {
      return {
        ok: false,
        code: 'permission-denied',
        message: 'Alfred needs Screen Recording permission to see what you’re looking at.',
      };
    }

    try {
      const reply = await askAboutScreen(question, apiKey);
      return { ok: true, reply };
    } catch (error) {
      if (error instanceof AskError) return { ok: false, code: error.code, message: error.message };
      return { ok: false, code: 'api-error', message: (error as Error).message || 'Something went wrong.' };
    }
  });
}

app.whenReady().then(() => {
  if (!isDev) applyProductionCsp();

  alfred = createFloatingWindow();
  applyAutoLaunch(getAutoLaunch());
  registerIpcHandlers(alfred);

  app.on('activate', () => {
    if (!alfred?.window.isVisible()) alfred?.window.show();
  });
});

app.on('window-all-closed', () => {
  // The floating window hides on blur but is never destroyed while the app is
  // running (quitting only ever happens via the tray's Quit item), so this only
  // fires on an actual app.quit() — always safe to let quit proceed here.
  if (process.platform !== 'darwin') app.quit();
});
