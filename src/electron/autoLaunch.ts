import { app } from 'electron';

// Electron's own setLoginItemSettings is the maintained, first-party mechanism
// for this on Windows and macOS (it writes/removes the registry Run key or the
// LaunchAgent plist internally) — there's no need for a third-party package
// that would just reimplement the same OS calls with less upkeep.
export function applyAutoLaunch(enabled: boolean) {
  if (!app.isPackaged) return; // never register a dev `tsx` process to launch at login
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
}
