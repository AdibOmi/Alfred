// A transparent, click-through window over the whole display that draws Alfred's
// ghost cursor and highlight ring on the element the user should click next.
import fs from 'fs';
import path from 'path';
import { BrowserWindow, app, screen, type Display } from 'electron';
import { boxToRect, type AssistResponse } from '../shared/guide';
import type { Rect } from './geometry';
import { cursorMoveSupported, glideCursor } from './cursor';

function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, '..', '..', 'resources', ...parts);
}

function overlayPreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'overlayPreload.js'),
    path.join(__dirname, '..', '..', 'dist', 'electron', 'overlayPreload.js'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Could not find the compiled overlay preload. Run `npm run build:main`.');
  return found;
}

export interface Overlay {
  window: BrowserWindow;
  /** Draws a step and returns where its target sits in screen coordinates (null when nothing to point at). */
  show: (result: AssistResponse, display: Display, moveRealCursor: boolean) => Rect | null;
  clear: () => void;
}

export function createOverlay(): Overlay {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: overlayPreloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(true);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.loadFile(resourcePath('overlay', 'overlay.html'));

  function clear() {
    if (window.isDestroyed()) return;
    window.webContents.send('overlay:clear');
    window.hide();
  }

  function show(result: AssistResponse, display: Display, moveRealCursor: boolean): Rect | null {
    const target = result.done ? null : boxToRect(result.step.box_2d, display.bounds);
    const mouse = screen.getCursorScreenPoint();

    window.setBounds(display.bounds);
    window.showInactive();
    window.webContents.send('overlay:show', {
      target,
      from: { x: mouse.x - display.bounds.x, y: mouse.y - display.bounds.y },
      instruction: result.done ? result.reply || result.step.instruction : result.step.instruction,
      label: result.step.target_label,
      action: result.step.action,
      position: result.step.position,
      done: result.done,
    });

    if (!target) return null;
    const onScreen = { ...target, x: target.x + display.bounds.x, y: target.y + display.bounds.y };

    if (moveRealCursor && cursorMoveSupported()) {
      // SetCursorPos wants physical pixels; Electron hands out DIPs.
      const toPhysical = (p: { x: number; y: number }) => (screen.dipToScreenPoint ? screen.dipToScreenPoint(p) : p);
      const centre = { x: onScreen.x + onScreen.width / 2, y: onScreen.y + onScreen.height / 2 };
      setTimeout(() => glideCursor(toPhysical(mouse), toPhysical(centre)), 300);
    }
    return onScreen;
  }

  return { window, show, clear };
}
