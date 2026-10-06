import { contextBridge, ipcRenderer } from 'electron';

// The overlay only ever listens: it is click-through and never sends anything back.
contextBridge.exposeInMainWorld('overlay', {
  onShow: (callback: (step: unknown) => void) => ipcRenderer.on('overlay:show', (_event, step) => callback(step)),
  onClear: (callback: () => void) => ipcRenderer.on('overlay:clear', () => callback()),
});
