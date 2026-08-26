import { contextBridge, ipcRenderer } from 'electron';

export interface AskResult {
  ok: boolean;
  reply?: string;
  code?: 'no-api-key' | 'permission-denied' | 'api-error';
  message?: string;
}

const alfred = {
  getState: (): Promise<{ hasApiKey: boolean; autoLaunch: boolean }> => ipcRenderer.invoke('alfred:getState'),
  setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('alfred:setApiKey', key),
  clearApiKey: (): Promise<void> => ipcRenderer.invoke('alfred:clearApiKey'),
  setAutoLaunch: (enabled: boolean): Promise<void> => ipcRenderer.invoke('alfred:setAutoLaunch', enabled),
  resetIconPosition: (): Promise<void> => ipcRenderer.invoke('alfred:resetIconPosition'),
  setExpanded: (expanded: boolean): Promise<void> => ipcRenderer.invoke('alfred:setExpanded', expanded),
  checkScreenPermission: (): Promise<string> => ipcRenderer.invoke('alfred:checkScreenPermission'),
  openScreenPermissionSettings: (): Promise<void> => ipcRenderer.invoke('alfred:openScreenPermissionSettings'),
  ask: (question: string): Promise<AskResult> => ipcRenderer.invoke('alfred:ask', question),
  onExpandedChanged: (callback: (expanded: boolean) => void) => {
    const listener = (_event: unknown, expanded: boolean) => callback(expanded);
    ipcRenderer.on('alfred:expanded-changed', listener);
    return () => {
      ipcRenderer.removeListener('alfred:expanded-changed', listener);
    };
  },
};

contextBridge.exposeInMainWorld('alfred', alfred);

export type AlfredBridge = typeof alfred;
