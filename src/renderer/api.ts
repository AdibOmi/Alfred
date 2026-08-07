import { BACKEND_ORIGIN } from '../shared/constants';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  due: string;
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

export interface GymLog {
  id: string;
  date: string;
  exercise: string;
  sets: number;
  reps: number;
  weight: number | null;
  notes: string | null;
  created_at: string;
}

export interface GymSummary {
  streak: number;
  weeklyVolume: { date: string; volume: number }[];
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
  createTask: (payload: { title: string; due: string; notes?: string }) =>
    apiFetch<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  quickCaptureTask: (text: string) =>
    apiFetch<{ task: Task; usedFallbackParser: boolean }>('/api/tasks/quick', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  updateTask: (id: string, payload: Partial<Pick<Task, 'title' | 'due' | 'notes' | 'status'>>) =>
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

  getGymLogs: () => apiFetch<{ logs: GymLog[] }>('/api/gym'),
  getGymSummary: () => apiFetch<GymSummary>('/api/gym/summary'),
  createGymLog: (payload: { date: string; exercise: string; sets: number; reps: number; weight?: number; notes?: string }) =>
    apiFetch<{ log: GymLog }>('/api/gym', { method: 'POST', body: JSON.stringify(payload) }),
  deleteGymLog: (id: string) => apiFetch<void>(`/api/gym/${id}`, { method: 'DELETE' }),

  getSettings: () => apiFetch<Settings>('/api/settings'),
};
