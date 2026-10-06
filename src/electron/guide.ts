// One guided session at a time: screenshot -> next step from the API -> point at it -> repeat.
// Every step is planned from a fresh screenshot, so Alfred adapts when a menu opens or a
// dialog appears instead of following a plan made for a screen that no longer exists.
import type { Display } from 'electron';
import { api } from './api';
import { captureActiveScreen } from './capture';
import type { Overlay } from './overlay';
import type { AlfredWindow } from './window';
import type { AssistResponse } from '../shared/guide';

export interface GuideState {
  active: boolean;
  goal: string | null;
  last: AssistResponse | null;
}

export interface Guide {
  start: (goal: string) => Promise<AssistResponse>;
  next: (message: string | null, completed: boolean) => Promise<AssistResponse>;
  replay: () => void;
  finish: (status: 'solved' | 'abandoned') => Promise<void>;
  reset: () => void;
  state: () => GuideState;
}

export function createGuide(panel: AlfredWindow, overlay: Overlay, moveRealCursor: () => boolean): Guide {
  let session: { id: number; goal: string } | null = null;
  let last: AssistResponse | null = null;
  let display: Display | null = null;
  let clearTimer: NodeJS.Timeout | null = null;

  function point(result: AssistResponse) {
    if (clearTimer) clearTimeout(clearTimer);
    last = result;
    if (!display) return;
    const target = overlay.show(result, display, moveRealCursor());
    panel.keepOnTop(); // showing the overlay pushes the panel out of the top-most band
    console.log(
      `[alfred] step ${result.step.position}${result.done ? ' (done)' : ''}: ${result.step.instruction}`,
      target ? `target ${JSON.stringify(target)}` : 'no target',
      `panel ${JSON.stringify(panel.window.getBounds())}`,
    );
    if (result.done) {
      session = null;
      panel.unpin();
      clearTimer = setTimeout(() => overlay.clear(), 5000);
    } else {
      panel.pin(target);
    }
  }

  async function capture() {
    const shot = await captureActiveScreen([panel.window, overlay.window]);
    display = shot.display;
    return shot.dataUrl;
  }

  return {
    async start(goal) {
      const screenshot = await capture();
      const result = await api.startSession(goal, screenshot);
      session = { id: result.session_id, goal };
      point(result);
      return result;
    },

    async next(message, completed) {
      if (!session) throw new Error('Tell Alfred what you need help with first.');
      overlay.clear();
      panel.keepOnTop();
      const screenshot = await capture();
      const result = await api.nextStep(session.id, screenshot, message, completed);
      point(result);
      return result;
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
