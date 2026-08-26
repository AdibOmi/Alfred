import type { AlfredBridge } from '../electron/preload';

declare global {
  interface Window {
    alfred: AlfredBridge;
  }
}

export {};
