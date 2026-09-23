import { contextBridge, ipcRenderer } from 'electron';
import type { Task, TaskDraft, TaskPatch } from '../shared/tasks';
import type { ChatTurn } from '../shared/history';

export interface AskResult {
  ok: boolean;
  reply?: string;
  usedScreen?: boolean;
  code?: 'no-api-key' | 'permission-denied' | 'api-error';
  message?: string;
}

export type { ChatTurn };

export type AlfredView = 'chat' | 'tasks';

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: unknown, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
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

  ask: (question: string, history: ChatTurn[]): Promise<AskResult> =>
    ipcRenderer.invoke('alfred:ask', question, history),

  listTasks: (): Promise<Task[]> => ipcRenderer.invoke('alfred:listTasks'),
  createTask: (draft: TaskDraft): Promise<Task> => ipcRenderer.invoke('alfred:createTask', draft),
  updateTask: (id: string, patch: TaskPatch): Promise<Task | null> =>
    ipcRenderer.invoke('alfred:updateTask', id, patch),
  deleteTask: (id: string): Promise<boolean> => ipcRenderer.invoke('alfred:deleteTask', id),
  clearCompletedTasks: (): Promise<number> => ipcRenderer.invoke('alfred:clearCompletedTasks'),

  onExpandedChanged: (callback: (expanded: boolean) => void) =>
    subscribe<boolean>('alfred:expanded-changed', callback),
  onTasksChanged: (callback: (tasks: Task[]) => void) => subscribe<Task[]>('alfred:tasks-changed', callback),
  onShowView: (callback: (view: AlfredView) => void) => subscribe<AlfredView>('alfred:show-view', callback),
};

contextBridge.exposeInMainWorld('alfred', alfred);

export type AlfredBridge = typeof alfred;
