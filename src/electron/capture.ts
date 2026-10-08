import { desktopCapturer, screen, systemPreferences, type BrowserWindow, type Display } from 'electron';
import { thumbnailSizeFor } from './geometry';
import { grabScreen } from './winScreen';

export type ScreenPermissionStatus = 'granted' | 'denied' | 'not-determined' | 'unsupported';

// Screen Recording permission is a macOS-only concept; every other platform can
// always capture, so callers should treat 'unsupported' as "nothing to check".
export function checkScreenPermission(): ScreenPermissionStatus {
  if (process.platform !== 'darwin') return 'unsupported';
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return 'granted';
  if (status === 'denied' || status === 'restricted') return 'denied';
  return 'not-determined';
}

// Native resolution on ordinary screens: small menu text that survives at full size gets dropped
// by OCR once it is scaled down. The server shrinks the image again before the model sees it.
const MAX_EDGE = 2560;

export interface CapturedScreen {
  /** data:image/jpeg;base64,… */
  dataUrl: string;
  /** The same JPEG, bare base64. */
  base64: string;
  /** Pixel size of the JPEG, which is not the display size: it is scaled to MAX_EDGE. */
  size: { width: number; height: number };
  display: Display;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captures the display under the cursor (a reasonable proxy for "what the user is
 * looking at" — Electron has no cross-platform "active window" API without extra
 * native modules) as an in-memory JPEG. Never touches disk.
 *
 * Alfred's own windows must not end up in the picture, or the model mostly sees
 * Alfred. They are excluded from capture for that instant (content protection:
 * WDA_EXCLUDEFROMCAPTURE on Windows, NSWindowSharingNone on macOS) instead of being
 * hidden or faded, so nothing on screen flickers, moves, blurs or collapses.
 * Protection is switched off again afterwards so screen recordings and screen
 * sharing still show Alfred.
 */
export async function captureActiveScreen(exclude: BrowserWindow[] = []): Promise<CapturedScreen> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const windows = exclude.filter((win) => !win.isDestroyed());

  for (const win of windows) win.setContentProtection(true);
  try {
    // The compositor applies the new affinity on its next frame.
    await wait(60);

    // Windows: a direct GDI grab, an order of magnitude faster than desktopCapturer.
    const physical = process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : null;
    const grabbed = physical && (await grabScreen(physical, MAX_EDGE));
    if (grabbed) {
      return {
        dataUrl: `data:image/jpeg;base64,${grabbed.base64}`,
        base64: grabbed.base64,
        size: { width: grabbed.width, height: grabbed.height },
        display,
      };
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: thumbnailSizeFor(
        { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor },
        MAX_EDGE,
      ),
    });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('Could not capture the screen.');
    }
    const base64 = source.thumbnail.toJPEG(82).toString('base64');
    return { dataUrl: `data:image/jpeg;base64,${base64}`, base64, size: source.thumbnail.getSize(), display };
  } finally {
    for (const win of windows) if (!win.isDestroyed()) win.setContentProtection(false);
  }
}
