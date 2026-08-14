import { BACKEND_ORIGIN } from '../shared/constants';

export type TaskKind = 'deadline' | 'todo';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  due: string | null;
  kind: TaskKind;
  status: 'active' | 'done';
  created_at: string;
  notified_at: string | null;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface SearchResult {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
}

export interface GithubProgress {
  configured: boolean;
  username?: string;
  source?: 'graphql' | 'rest';
  dailyCommits?: { date: string; count: number }[];
  totals?: { commits: number; pullRequests: number; issues: number };
  error?: string;
}

export interface LeetcodeProgress {
  configured: boolean;
  username?: string;
  difficulty?: { easy: number; medium: number; hard: number; total: number };
  streak?: number;
  totalActiveDays?: number;
  recentActivity?: { date: string; count: number }[];
  error?: string;
}

export interface Tracker {
  id: string;
  type: 'github' | 'leetcode' | 'manual';
  name: string;
  unit: string | null;
  position: number;
  enabled: boolean;
  created_at: string;
}

export interface TrackerLog {
  id: string;
  tracker_id: string;
  date: string;
  label: string | null;
  value: number;
  notes: string | null;
  created_at: string;
}

export interface TrackerSummary {
  streak: number;
  series: { date: string; value: number }[];
  totalEntries: number;
}

export interface Settings {
  anthropicConfigured: boolean;
  githubConfigured: boolean;
  githubAuthenticated: boolean;
  leetcodeConfigured: boolean;
  githubUsername: string | null;
  leetcodeUsername: string | null;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_ORIGIN}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok && response.status !== 204) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  getTasks: () => apiFetch<{ tasks: Task[] }>('/api/tasks'),
  createTask: (payload: { title: string; due?: string | null; notes?: string; kind?: TaskKind }) =>
    apiFetch<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  quickCaptureTask: (text: string, kind?: TaskKind) =>
    apiFetch<{ task: Task; usedFallbackParser: boolean }>('/api/tasks/quick', {
      method: 'POST',
      body: JSON.stringify({ text, kind }),
    }),
  updateTask: (id: string, payload: Partial<Pick<Task, 'title' | 'due' | 'notes' | 'status' | 'kind'>>) =>
    apiFetch<{ task: Task }>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTask: (id: string) => apiFetch<void>(`/api/tasks/${id}`, { method: 'DELETE' }),

  searchFiles: (query: string) => apiFetch<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`),
  openSearchResult: (path: string, reveal: boolean) =>
    apiFetch<void>('/api/search/open', { method: 'POST', body: JSON.stringify({ path, reveal }) }),

  getChatHistory: () => apiFetch<{ messages: ChatMessage[] }>('/api/chat'),
  sendChatMessage: (message: string) =>
    apiFetch<{ reply: string; configured: boolean }>('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }),

  getGithubProgress: () => apiFetch<GithubProgress>('/api/progress/github'),
  getLeetcodeProgress: () => apiFetch<LeetcodeProgress>('/api/progress/leetcode'),

  getTrackers: () => apiFetch<{ trackers: Tracker[] }>('/api/trackers'),
  createTracker: (payload: { type: Tracker['type']; name?: string; unit?: string }) =>
    apiFetch<{ tracker: Tracker }>('/api/trackers', { method: 'POST', body: JSON.stringify(payload) }),
  updateTracker: (id: string, payload: Partial<Pick<Tracker, 'name' | 'unit' | 'enabled'>>) =>
    apiFetch<{ tracker: Tracker }>(`/api/trackers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  moveTracker: (id: string, direction: 'up' | 'down') =>
    apiFetch<{ trackers: Tracker[] }>(`/api/trackers/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) }),
  deleteTracker: (id: string) => apiFetch<void>(`/api/trackers/${id}`, { method: 'DELETE' }),

  getTrackerLogs: (id: string) => apiFetch<{ logs: TrackerLog[] }>(`/api/trackers/${id}/logs`),
  getTrackerSummary: (id: string) => apiFetch<TrackerSummary>(`/api/trackers/${id}/summary`),
  createTrackerLog: (id: string, payload: { date: string; label?: string; value: number; notes?: string }) =>
    apiFetch<{ log: TrackerLog }>(`/api/trackers/${id}/logs`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteTrackerLog: (id: string, logId: string) => apiFetch<void>(`/api/trackers/${id}/logs/${logId}`, { method: 'DELETE' }),

  getSettings: () => apiFetch<Settings>('/api/settings'),
};
