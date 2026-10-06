import { desktopCapturer, screen, systemPreferences, type BrowserWindow, type Display } from 'electron';
import { thumbnailSizeFor } from './geometry';

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

// Big enough for the vision model to read menu labels; the server downscales further.
const MAX_EDGE = 1600;

export interface CapturedScreen {
  /** data:image/jpeg;base64,… */
  dataUrl: string;
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
    return { dataUrl: `data:image/jpeg;base64,${source.thumbnail.toJPEG(82).toString('base64')}`, display };
  } finally {
    for (const win of windows) if (!win.isDestroyed()) win.setContentProtection(false);
  }
}
