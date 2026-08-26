import Store from 'electron-store';
import { safeStorage } from 'electron';

interface StoreSchema {
  encryptedApiKey: string | null;
  autoLaunch: boolean;
  iconPosition: { x: number; y: number } | null;
}

const store = new Store<StoreSchema>({
  name: 'alfred-config',
  defaults: {
    encryptedApiKey: null,
    autoLaunch: false,
    iconPosition: null,
  },
});

// safeStorage only works once Electron has finished starting up (app.whenReady),
// and can be unavailable if the OS has no credential store configured — callers
// should treat that as "no key configured" rather than crashing.
export function getApiKey(): string | undefined {
  const encrypted = store.get('encryptedApiKey');
  if (!encrypted) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return undefined;
  }
}

export function hasApiKey(): boolean {
  return Boolean(store.get('encryptedApiKey'));
}

export function setApiKey(key: string) {
  const trimmed = key.trim();
  if (!trimmed) {
    store.set('encryptedApiKey', null);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system.');
  }
  const encrypted = safeStorage.encryptString(trimmed).toString('base64');
  store.set('encryptedApiKey', encrypted);
}

export function clearApiKey() {
  store.set('encryptedApiKey', null);
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
