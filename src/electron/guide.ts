// One guided session at a time: screenshot -> next step from the API -> point at it -> repeat.
// Every step is planned from a fresh screenshot, so Alfred adapts when a menu opens or a
// dialog appears instead of following a plan made for a screen that no longer exists.
//
// Speed: the screenshot is read by OCR on this machine while the model is still thinking, so by
// the time the step arrives Alfred already knows where every label on screen is, and can snap
// the pointer onto the element the model named at no extra cost.
import { api } from './api';
import { captureActiveScreen, type CapturedScreen } from './capture';
import { recognizeText } from './winScreen';
import type { Overlay } from './overlay';
import type { AlfredWindow } from './window';
import type { AssistResponse } from '../shared/guide';
import { findLabel, type OcrLine } from '../shared/snap';

export interface GuideState {
  active: boolean;
  goal: string | null;
  last: AssistResponse | null;
}

/** A screenshot taken ahead of time, with its OCR already running. */
export interface PreparedScreen extends CapturedScreen {
  text: Promise<OcrLine[]>;
}

export interface Guide {
  /** Captures the screen and starts reading it, before Alfred knows whether it will need it. */
  prepare: () => Promise<PreparedScreen>;
  start: (goal: string, prepared?: PreparedScreen | null) => Promise<AssistResponse>;
  next: (message: string | null, completed: boolean) => Promise<AssistResponse>;
  replay: () => void;
  finish: (status: 'solved' | 'abandoned') => Promise<void>;
  reset: () => void;
  state: () => GuideState;
}

/**
 * Puts the step's box on the element whose text the model named. A box from a model that
 * places boxes loosely (trusted_boxes false) is only kept once OCR has confirmed it.
 */
export async function placePointer(result: AssistResponse, shot: PreparedScreen): Promise<AssistResponse> {
  if (result.done) return result;
  const text = await shot.text;
  const snapped = findLabel(text, result.step.target_label, shot.size, result.step.box_2d);
  const trusted = result.trusted_boxes !== false;
  const box = snapped ?? (trusted ? result.step.box_2d : null);
  console.log(
    `[alfred] step ${result.step.position} "${result.step.target_label ?? ''}":`,
    snapped ? `on screen ${JSON.stringify(snapped)}` : box ? `model box ${JSON.stringify(box)}` : 'not found, words only',
    snapped ? '' : `(${text.length} lines of text on screen)`,
  );
  return { ...result, step: { ...result.step, box_2d: box } };
}

export function createGuide(panel: AlfredWindow, overlay: Overlay, moveRealCursor: () => boolean): Guide {
  let session: { id: number; goal: string } | null = null;
  let last: AssistResponse | null = null;
  let display: CapturedScreen['display'] | null = null;
  let clearTimer: NodeJS.Timeout | null = null;

  function point(result: AssistResponse) {
    if (clearTimer) clearTimeout(clearTimer);
    last = result;
    if (!display) return;
    const target = overlay.show(result, display, moveRealCursor());
    panel.keepOnTop(); // showing the overlay pushes the panel out of the top-most band
    if (result.done) {
      session = null;
      panel.unpin();
      clearTimer = setTimeout(() => overlay.clear(), 5000);
    } else {
      panel.pin(target);
    }
  }

  async function prepare(): Promise<PreparedScreen> {
    const shot = await captureActiveScreen([panel.window, overlay.window]);
    return { ...shot, text: recognizeText(shot.base64) };
  }

  async function show(result: AssistResponse, shot: PreparedScreen) {
    display = shot.display;
    const placed = await placePointer(result, shot);
    point(placed);
    return placed;
  }

  return {
    prepare,

    async start(goal, prepared) {
      const shot = prepared ?? (await prepare());
      const sent = Date.now();
      const result = await api.startSession(goal, shot.dataUrl);
      console.log(`[alfred] server answered in ${Date.now() - sent} ms (${Math.round(shot.base64.length / 1024)} KB screenshot)`);
      session = { id: result.session_id, goal };
      return show(result, shot);
    },

    async next(message, completed) {
      if (!session) throw new Error('Tell Alfred what you need help with first.');
      overlay.clear();
      panel.keepOnTop();
      const shot = await prepare();
      const result = await api.nextStep(session.id, shot.dataUrl, message, completed);
      return show(result, shot);
    },

    replay() {
      if (last) point(last);
    },

    async finish(status) {
      const ending = session;
      session = null;
      last = null;
      overlay.clear();
      panel.unpin();
      if (ending) await api.setSessionStatus(ending.id, status);
    },

    reset() {
      session = null;
      last = null;
      overlay.clear();
      panel.unpin();
    },

    state: () => ({ active: Boolean(session), goal: session?.goal ?? null, last }),
  };
}
