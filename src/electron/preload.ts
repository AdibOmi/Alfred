import { contextBridge, ipcRenderer } from 'electron';
import type { Task, TaskDraft, TaskPatch } from '../shared/tasks';
import type { ChatTurn } from '../shared/history';
import type { AssistResponse } from '../shared/guide';
import type { AlfredUser } from './store';
import type { SessionDetail, SessionSummary, Stats } from './api';

export type ErrorCode = 'signed-out' | 'permission-denied' | 'api-error';
export type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };

export interface AppState {
  user: AlfredUser | null;
  apiBase: string;
  autoLaunch: boolean;
  moveRealCursor: boolean;
  canMoveCursor: boolean;
  guide: { active: boolean; goal: string | null; last: AssistResponse | null };
}

export interface AskOutcome {
  reply: string;
  usedScreen: boolean;
  guide: AssistResponse | null;
}

export type { ChatTurn, AssistResponse, SessionDetail, SessionSummary, Stats };

export type AlfredView = 'chat' | 'tasks' | 'history';

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: unknown, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => ipcRenderer.invoke(channel, ...args);

const alfred = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('alfred:getState'),
  signup: (name: string, email: string, password: string) => invoke<AppState>('alfred:signup', name, email, password),
  login: (email: string, password: string) => invoke<AppState>('alfred:login', email, password),
  logout: () => invoke<AppState>('alfred:logout'),

  setApiBase: (url: string) => invoke<AppState>('alfred:setApiBase', url),
  setAutoLaunch: (enabled: boolean) => invoke<AppState>('alfred:setAutoLaunch', enabled),
  setMoveRealCursor: (enabled: boolean) => invoke<AppState>('alfred:setMoveRealCursor', enabled),
  setWeeklyReport: (enabled: boolean) => invoke<AppState>('alfred:setWeeklyReport', enabled),
  resetIconPosition: (): Promise<void> => ipcRenderer.invoke('alfred:resetIconPosition'),
  setExpanded: (expanded: boolean): Promise<void> => ipcRenderer.invoke('alfred:setExpanded', expanded),
  iconDragStart: () => ipcRenderer.send('alfred:iconDragStart'),
  iconDragMove: (dx: number, dy: number) => ipcRenderer.send('alfred:iconDragMove', dx, dy),
  iconDragEnd: () => ipcRenderer.send('alfred:iconDragEnd'),
  checkScreenPermission: (): Promise<string> => ipcRenderer.invoke('alfred:checkScreenPermission'),
  openScreenPermissionSettings: (): Promise<void> => ipcRenderer.invoke('alfred:openScreenPermissionSettings'),

  ask: (question: string, history: ChatTurn[]) => invoke<AskOutcome>('alfred:ask', question, history),
  guideNext: (message: string | null, completed: boolean) =>
    invoke<AssistResponse>('alfred:guideNext', message, completed),
  guideReplay: () => invoke<void>('alfred:guideReplay'),
  guideFinish: (status: 'solved' | 'abandoned') => invoke<void>('alfred:guideFinish', status),

  history: () => invoke<{ sessions: SessionSummary[]; stats: Stats }>('alfred:history'),
  session: (id: number) => invoke<SessionDetail>('alfred:session', id),
  openReport: () => invoke<string>('alfred:openReport'),
  emailReport: () => invoke<{ queued: boolean; email_enabled: boolean; message: string }>('alfred:emailReport'),

  listTasks: (): Promise<Task[]> => ipcRenderer.invoke('alfred:listTasks'),
  refreshTasks: () => invoke<Task[]>('alfred:refreshTasks'),
  createTask: (draft: TaskDraft) => invoke<Task | null>('alfred:createTask', draft),
  updateTask: (id: string, patch: TaskPatch) => invoke<Task | null>('alfred:updateTask', id, patch),
  deleteTask: (id: string) => invoke<boolean>('alfred:deleteTask', id),
  clearCompletedTasks: () => invoke<number>('alfred:clearCompletedTasks'),

  onExpandedChanged: (callback: (expanded: boolean) => void) =>
    subscribe<boolean>('alfred:expanded-changed', callback),
  onTasksChanged: (callback: (tasks: Task[]) => void) => subscribe<Task[]>('alfred:tasks-changed', callback),
  onShowView: (callback: (view: AlfredView) => void) => subscribe<AlfredView>('alfred:show-view', callback),
};

contextBridge.exposeInMainWorld('alfred', alfred);

export type AlfredBridge = typeof alfred;
