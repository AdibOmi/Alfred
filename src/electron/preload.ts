import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  notify: (payload: { title: string; body: string }) => ipcRenderer.invoke('notify', payload),
});
