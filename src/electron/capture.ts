import { desktopCapturer, screen, systemPreferences } from 'electron';
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

const MAX_EDGE = 1568;

export interface CapturedScreenshot {
  base64: string;
  mediaType: 'image/png';
}

// Captures the display under the current cursor (a reasonable proxy for "what
// the user is looking at" — Electron has no cross-platform "active window"
// API without extra native modules) as an in-memory PNG. Never touches disk.
export async function captureActiveScreen(): Promise<CapturedScreenshot> {
  const cursorPoint = screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: thumbnailSizeFor(targetDisplay.size, MAX_EDGE),
  });

  const source =
    sources.find((s) => s.display_id === String(targetDisplay.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Could not capture the screen.');
  }

  return { base64: source.thumbnail.toPNG().toString('base64'), mediaType: 'image/png' };
}
