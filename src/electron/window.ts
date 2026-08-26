import path from 'path';
import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from 'electron';
import isDev from 'electron-is-dev';
import { getIconPosition, setIconPosition } from './store';
import { ICON_SIZE } from '../shared/constants';
import { defaultIconPosition as computeDefaultIconPosition, expandedBounds as computeExpandedBounds } from './geometry';

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;
const SCREEN_MARGIN = 24;

const TRAY_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'tray-icon.png')
  : path.join(__dirname, '..', '..', 'resources', 'tray-icon.png');

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
      preload: path.join(__dirname, 'preload.js'),
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
    {
      label: 'Show/Hide Alfred',
      click: () => (window.isVisible() ? window.hide() : window.show()),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => (window.isVisible() ? window.hide() : window.show()));

  return { window, tray, expand, collapse, resetPosition };
}
