import fs from 'fs';
import path from 'path';
import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from 'electron';
import isDev from 'electron-is-dev';
import { getIconPosition, setIconPosition } from './store';
import { ICON_SIZE } from '../shared/constants';
import { defaultIconPosition as computeDefaultIconPosition, expandedBounds as computeExpandedBounds } from './geometry';

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 560;
const SCREEN_MARGIN = 24;

const TRAY_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'tray-icon.png')
  : path.join(__dirname, '..', '..', 'resources', 'tray-icon.png');

/**
 * Locates the compiled preload script.
 *
 * The preload always has to be real JavaScript: it runs in its own sandboxed
 * context, outside the dev-time TypeScript loader that `npm start` applies to
 * the main process. So in development, where main.ts is executed straight out
 * of src/electron, the preload still has to come from the build output.
 *
 * Getting this wrong fails silently and spectacularly — Electron drops a
 * missing preload without a word, the renderer never receives window.alfred,
 * and the first bridge call throws, leaving a blank panel with no error. Hence
 * the explicit throw.
 */
function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.js'), // packaged, or running the compiled main
    path.join(__dirname, '..', '..', 'dist', 'electron', 'preload.js'), // dev, from src
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      'Could not find the compiled preload script. Run `npm run build:main` to compile it. Looked in: ' +
        candidates.join(', '),
    );
  }
  return found;
}

function defaultIconPosition(): { x: number; y: number } {
  return computeDefaultIconPosition(screen.getPrimaryDisplay().workArea, ICON_SIZE, SCREEN_MARGIN);
}

function expandedBounds(iconPosition: { x: number; y: number }) {
  const { workArea } = screen.getDisplayNearestPoint(iconPosition);
  return computeExpandedBounds(iconPosition, ICON_SIZE, PANEL_WIDTH, PANEL_HEIGHT, workArea);
}

export interface AlfredWindow {
  window: BrowserWindow;
  tray: Tray;
  expand: () => void;
  collapse: () => void;
  toggle: () => void;
  resetPosition: () => void;
}

export function createFloatingWindow(): AlfredWindow {
  const startPosition = getIconPosition() ?? defaultIconPosition();

  const window = new BrowserWindow({
    x: startPosition.x,
    y: startPosition.y,
    width: ICON_SIZE,
    height: ICON_SIZE,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const url = isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '../renderer/index.html')}`;
  window.loadURL(url);
  window.once('ready-to-show', () => window.show());

  let expanded = false;

  // Only the collapsed (icon-only) size is ever a real "icon position" — skip
  // persisting bounds captured mid-expand/collapse or while the panel is open.
  window.on('moved', () => {
    if (expanded) return;
    const bounds = window.getBounds();
    setIconPosition({ x: bounds.x, y: bounds.y });
  });

  window.on('blur', () => {
    if (expanded) collapse();
  });

  function expand() {
    if (expanded) return;
    expanded = true;
    const iconBounds = window.getBounds();
    window.setResizable(true);
    window.setBounds(expandedBounds(iconBounds), true);
    window.setResizable(false);
    window.focus();
    window.webContents.send('alfred:expanded-changed', true);
  }

  function collapse() {
    if (!expanded) return;
    expanded = false;
    const iconPosition = getIconPosition() ?? defaultIconPosition();
    window.setResizable(true);
    window.setBounds({ ...iconPosition, width: ICON_SIZE, height: ICON_SIZE }, true);
    window.setResizable(false);
    window.webContents.send('alfred:expanded-changed', false);
  }

  // What the tray item and the global shortcut both call: summon Alfred with
  // the panel already open, or put it away if it is already open.
  function toggle() {
    if (expanded) {
      collapse();
      return;
    }
    if (!window.isVisible()) window.show();
    expand();
  }

  function showView(view: 'chat' | 'tasks') {
    if (!window.isVisible()) window.show();
    expand();
    window.webContents.send('alfred:show-view', view);
  }

  function resetPosition() {
    const position = defaultIconPosition();
    setIconPosition(position);
    if (!expanded) {
      window.setBounds({ ...position, width: ICON_SIZE, height: ICON_SIZE });
    }
  }

  const tray = new Tray(nativeImage.createFromPath(TRAY_ICON_PATH));
  tray.setToolTip('Alfred');
  const menu = Menu.buildFromTemplate([
    { label: 'Ask Alfred', click: () => showView('chat') },
    { label: 'Tasks & reminders', click: () => showView('tasks') },
    { type: 'separator' },
    {
      label: 'Hide floating icon',
      click: () => (window.isVisible() ? window.hide() : window.show()),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => toggle());

  return { window, tray, expand, collapse, toggle, resetPosition };
}
