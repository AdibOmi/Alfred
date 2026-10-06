import Store from 'electron-store';
import { safeStorage } from 'electron';

export interface AlfredUser {
  id: number;
  email: string;
  name: string;
  weekly_report: boolean;
  created_at: string;
}

interface StoreSchema {
  encryptedToken: string | null;
  user: AlfredUser | null;
  apiBase: string;
  moveRealCursor: boolean;
  autoLaunch: boolean;
  iconPosition: { x: number; y: number } | null;
}

export const DEFAULT_API_BASE = 'http://127.0.0.1:8000';

const store = new Store<StoreSchema>({
  name: 'alfred-config',
  defaults: {
    encryptedToken: null,
    user: null,
    apiBase: DEFAULT_API_BASE,
    moveRealCursor: false,
    autoLaunch: false,
    iconPosition: null,
  },
});

// safeStorage only works once Electron has finished starting up (app.whenReady),
// and can be unavailable if the OS has no credential store configured. In that
// case the session token is kept for this run only rather than written in clear.
let memoryToken: string | null = null;

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  const encrypted = store.get('encryptedToken');
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null;
  try {
    memoryToken = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    return memoryToken;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AlfredUser) {
  memoryToken = token;
  store.set('user', user);
  store.set(
    'encryptedToken',
    safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token).toString('base64') : null,
  );
}

export function clearSession() {
  memoryToken = null;
  store.set('encryptedToken', null);
  store.set('user', null);
}

export function getUser(): AlfredUser | null {
  return getToken() ? store.get('user') : null;
}

export function setUser(user: AlfredUser) {
  store.set('user', user);
}

export function getApiBase(): string {
  return store.get('apiBase') || DEFAULT_API_BASE;
}

export function setApiBase(url: string) {
  store.set('apiBase', url.trim().replace(/\/+$/, '') || DEFAULT_API_BASE);
}

export function getMoveRealCursor(): boolean {
  return store.get('moveRealCursor');
}

export function setMoveRealCursor(enabled: boolean) {
  store.set('moveRealCursor', enabled);
}

export function getAutoLaunch(): boolean {
  return store.get('autoLaunch');
}

export function setAutoLaunchPref(enabled: boolean) {
  store.set('autoLaunch', enabled);
}

export function getIconPosition(): { x: number; y: number } | null {
  return store.get('iconPosition');
}

export function setIconPosition(position: { x: number; y: number } | null) {
  store.set('iconPosition', position);
}
