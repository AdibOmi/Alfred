// Geometry for guided steps: where the model's box lands on a real display, and where the
// panel can sit without covering it. Electron-free so it can be unit-tested directly.

import type { Rect, Size } from '../electron/geometry';

/** [ymin, xmin, ymax, xmax], each normalised 0-1000 over the screenshot. */
export type Box2d = [number, number, number, number];

export interface GuideStep {
  id: number | null;
  position: number;
  instruction: string;
  target_label: string | null;
  action: string;
  box_2d: Box2d | null;
}

/** What the API returns for every guided step (POST /sessions and /sessions/{id}/next). */
export interface AssistResponse {
  session_id: number;
  status: 'active' | 'solved' | 'abandoned';
  app: string;
  reply: string;
  step: GuideStep;
  steps_remaining: number;
  done: boolean;
  from_cache: boolean;
  provider: string;
}

/**
 * Maps a normalised box onto a display, in coordinates relative to that display.
 * Normalised coordinates are why one answer works on any resolution or DPI.
 */
export function boxToRect(box: Box2d | null, display: Size): Rect | null {
  if (!box) return null;
  const [ymin, xmin, ymax, xmax] = box;
  return {
    x: Math.round((xmin / 1000) * display.width),
    y: Math.round((ymin / 1000) * display.height),
    width: Math.max(1, Math.round(((xmax - xmin) / 1000) * display.width)),
    height: Math.max(1, Math.round(((ymax - ymin) / 1000) * display.height)),
  };
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return !(
    a.x > b.x + b.width + gap ||
    a.x + a.width + gap < b.x ||
    a.y > b.y + b.height + gap ||
    a.y + a.height + gap < b.y
  );
}

/**
 * Where the panel should sit while a step is shown. Keeps the current spot when it is
 * clear of the target, otherwise tries the other corners of the work area.
 */
export function panelSpotAvoiding(current: Rect, workArea: Rect, avoid: Rect | null, margin = 24): Rect {
  if (!avoid || !rectsOverlap(current, avoid, 16)) return current;
  const { width, height } = current;
  const corners: Rect[] = [
    { x: workArea.x + workArea.width - width - margin, y: workArea.y + workArea.height - height - margin, width, height },
    { x: workArea.x + margin, y: workArea.y + workArea.height - height - margin, width, height },
    { x: workArea.x + workArea.width - width - margin, y: workArea.y + margin, width, height },
    { x: workArea.x + margin, y: workArea.y + margin, width, height },
  ];
  return corners.find((corner) => !rectsOverlap(corner, avoid, 16)) ?? current;
}
