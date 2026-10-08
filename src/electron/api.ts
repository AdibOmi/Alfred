// Client for the Alfred backend. Lives in the main process so the session token never
// reaches the renderer. Every failure becomes an ApiError whose message is safe to show.
import { getApiBase, getToken, type AlfredUser } from './store';
import { whenBackendReady } from './backend';
import type { AssistResponse } from '../shared/guide';
import type { ChatTurn } from '../shared/history';

const TIMEOUT_MS = 90_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, route: string, body?: unknown, raw = false): Promise<T> {
  // A local backend may still be booting when the first request goes out.
  await whenBackendReady();
  const base = getApiBase();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(`Alfred can't reach its server at ${base}. Is the backend running?`, 0);
  }

  if (!response.ok) {
    let message = `Server error (${response.status})`;
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (raw ? Buffer.from(await response.arrayBuffer()) : await response.json()) as T;
}

export interface AuthResponse {
  access_token: string;
  user: AlfredUser;
}

export interface ChatResponse {
  reply: string;
  changed_tasks: boolean;
  look_at_screen: { goal: string } | null;
}

export interface SessionSummary {
  id: number;
  goal: string;
  app_name: string | null;
  status: string;
  step_count: number;
  created_at: string;
  updated_at: string;
}

export interface SessionDetail extends SessionSummary {
  steps: AssistResponse['step'][];
  messages: { role: string; content: string; created_at: string }[];
}

export interface Stats {
  sessions: number;
  solved: number;
  abandoned: number;
  steps: number;
  cached_steps: number;
  top_apps: { app: string; sessions: number }[];
}

export interface ServerTask {
  id: string;
  title: string;
  notes: string | null;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
  remindAt: string | null;
  remindedAt: string | null;
}

export const api = {
  health: () => request<{ status: string; llm_provider: string }>('GET', '/health'),
  signup: (name: string, email: string, password: string) =>
    request<AuthResponse>('POST', '/auth/signup', { name, email, password }),
  login: (email: string, password: string) => request<AuthResponse>('POST', '/auth/login', { email, password }),
  me: () => request<AlfredUser>('GET', '/auth/me'),
  updateMe: (changes: { weekly_report?: boolean; name?: string }) => request<AlfredUser>('PATCH', '/auth/me', changes),

  chat: (message: string, history: ChatTurn[], clientTime: string) =>
    request<ChatResponse>('POST', '/chat', { message, history, client_time: clientTime }),
  startSession: (goal: string, screenshot: string) => request<AssistResponse>('POST', '/sessions', { goal, screenshot }),
  nextStep: (id: number, screenshot: string, message: string | null, completed: boolean) =>
    request<AssistResponse>('POST', `/sessions/${id}/next`, { screenshot, message, completed }),
  setSessionStatus: (id: number, status: 'solved' | 'abandoned') =>
    request<SessionSummary>('PATCH', `/sessions/${id}`, { status }),
  listSessions: () => request<SessionSummary[]>('GET', '/sessions?limit=30'),
  getSession: (id: number) => request<SessionDetail>('GET', `/sessions/${id}`),
  stats: () => request<Stats>('GET', '/stats'),
  weeklyPdf: () => request<Buffer>('GET', '/reports/weekly.pdf', undefined, true),
  emailReport: () => request<{ queued: boolean; email_enabled: boolean; message: string }>('POST', '/reports/email', {}),

  listTasks: () => request<ServerTask[]>('GET', '/tasks'),
  createTask: (draft: { title: string; notes?: string | null; remindAt?: string | null }) =>
    request<ServerTask>('POST', '/tasks', draft),
  updateTask: (id: string, patch: Record<string, unknown>) => request<ServerTask>('PATCH', `/tasks/${id}`, patch),
  deleteTask: (id: string) => request<void>('DELETE', `/tasks/${id}`),
  clearCompleted: () => request<{ removed: number }>('POST', '/tasks/clear-completed'),
};

/** The user's local time with its UTC offset, so the server can resolve "at 5pm". */
export function localTimeWithOffset(now = new Date()): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:` +
    `${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}
