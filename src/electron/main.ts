import path from 'path';
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, session } from 'electron';
import isDev from 'electron-is-dev';
import { startBackend, type BackendHandle } from '../backend/service';
import { getPendingNotifications, markNotified } from '../backend/db';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backend: BackendHandle | null = null;
let isQuitting = false;

// `build/` is a build-time-only input for electron-builder (it bakes the .exe/.app
// icon from build/icon.png) and isn't shipped inside the packaged app, so it's only
// safe to read at runtime when running from source. The tray icon, by contrast, is
// loaded programmatically at runtime in both dev and prod, so it ships via
// `extraResources` (see package.json) and is read from process.resourcesPath when packaged.
const DEV_APP_ICON_PATH = path.join(__dirname, '..', '..', 'build', 'icon.png');
const TRAY_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'tray-icon.png')
  : path.join(__dirname, '..', '..', 'resources', 'tray-icon.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#08080a',
    show: false,
    icon: isDev ? DEV_APP_ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const url = isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '../renderer/index.html')}`;

  mainWindow.loadURL(url);
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
    tray = new Tray(icon);
    const menu = Menu.buildFromTemplate([
      { label: 'Show Alfred', click: () => mainWindow?.show() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setToolTip('Alfred');
    tray.setContextMenu(menu);
    tray.on('double-click', () => mainWindow?.show());
  } catch (error) {
    console.error('Failed to create tray icon:', error);
  }
}

const PRODUCTION_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; connect-src 'self' http://127.0.0.1:4789;";

// A CSP is only applied in production: the Vite dev server needs eval() for HMR
// and serves from a different origin, so a strict policy would break `npm start`.
function applyProductionCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PRODUCTION_CSP],
      },
    });
  });
}

const NOTIFICATION_LOOKAHEAD_MINUTES = 15;
const NOTIFICATION_POLL_MS = 60 * 1000;

function startNotificationScheduler(handle: BackendHandle) {
  const check = () => {
    const due = getPendingNotifications(handle.db, NOTIFICATION_LOOKAHEAD_MINUTES);
    for (const task of due) {
      const overdue = new Date(task.due).getTime() < Date.now();
      new Notification({
        title: overdue ? 'Overdue' : 'Coming up',
        body: task.title,
        icon: TRAY_ICON_PATH,
      }).show();
      markNotified(handle.db, task.id);
    }
  };

  check();
  return setInterval(check, NOTIFICATION_POLL_MS);
}

function configureAutoLaunch() {
  // Only register the packaged app (not a dev `tsx` process) to launch at login,
  // and only on the platforms Electron actually supports this on.
  if (!app.isPackaged) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
  });
}

app.whenReady().then(() => {
  if (!isDev) applyProductionCsp();
  configureAutoLaunch();

  backend = startBackend(app.getPath('userData'));
  const timer = startNotificationScheduler(backend);
  app.on('will-quit', () => clearInterval(timer));

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  backend?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('notify', (_, payload: { title: string; body: string }) => {
  new Notification({ ...payload, icon: TRAY_ICON_PATH }).show();
});
