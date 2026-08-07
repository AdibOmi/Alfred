import { Router } from 'express';
import { withCache } from '../cache';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface DailyCount {
  date: string;
  count: number;
}

interface GithubProgress {
  configured: boolean;
  username?: string;
  source?: 'graphql' | 'rest';
  dailyCommits?: DailyCount[];
  totals?: { commits: number; pullRequests: number; issues: number };
  error?: string;
}

interface GraphQLResponse {
  errors?: { message: string }[];
  data?: {
    user?: {
      contributionsCollection?: {
        totalCommitContributions: number;
        totalPullRequestContributions: number;
        totalIssueContributions: number;
        contributionCalendar: {
          weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
        };
      };
    };
  };
}

interface GithubPublicEvent {
  type: string;
  created_at: string;
  payload?: { commits?: unknown[] };
}

export function githubRouter(getUsername: () => string | undefined, getToken: () => string | undefined) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const username = getUsername();
    if (!username) return res.json({ configured: false } satisfies GithubProgress);

    const token = getToken();
    const cacheKey = `github:${username}:${token ? 'auth' : 'anon'}`;

    try {
      const data = await withCache(cacheKey, CACHE_TTL_MS, () =>
        token ? fetchViaGraphQL(username, token) : fetchViaRest(username),
      );
      res.json(data);
    } catch (error) {
      res.json({ configured: true, username, error: (error as Error).message } satisfies GithubProgress);
    }
  });

  return router;
}

async function fetchViaGraphQL(username: string, token: string): Promise<GithubProgress> {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);

  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
          contributionCalendar {
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }
  `;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Alfred-Assistant',
    },
    body: JSON.stringify({ query, variables: { login: username, from: from.toISOString(), to: to.toISOString() } }),
  });

  if (!response.ok) throw new Error(`GitHub GraphQL error: ${response.status}`);
  const json = (await response.json()) as GraphQLResponse;
  if (json.errors?.length) throw new Error(json.errors[0].message);

  const collection = json.data?.user?.contributionsCollection;
  if (!collection) throw new Error('unexpected GitHub response shape');

  const days: DailyCount[] = collection.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .map((day) => ({ date: day.date, count: day.contributionCount }));

  return {
    configured: true,
    username,
    source: 'graphql',
    dailyCommits: days.slice(-14),
    totals: {
      commits: collection.totalCommitContributions,
      pullRequests: collection.totalPullRequestContributions,
      issues: collection.totalIssueContributions,
    },
  };
}

async function fetchViaRest(username: string): Promise<GithubProgress> {
  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`, {
    headers: { 'User-Agent': 'Alfred-Assistant', Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub REST error: ${response.status}`);
  const events = (await response.json()) as GithubPublicEvent[];

  const byDate = new Map<string, number>();
  let pullRequests = 0;
  let issues = 0;

  for (const event of events) {
    const date = event.created_at?.slice(0, 10);
    if (!date) continue;
    if (event.type === 'PushEvent') {
      const commitCount = Array.isArray(event.payload?.commits) ? event.payload.commits.length : 0;
      byDate.set(date, (byDate.get(date) ?? 0) + commitCount);
    } else if (event.type === 'PullRequestEvent') {
      pullRequests += 1;
    } else if (event.type === 'IssuesEvent') {
      issues += 1;
    }
  }

  const days: DailyCount[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    days.push({ date, count: byDate.get(date) ?? 0 });
  }

  const totalCommits = days.reduce((sum, day) => sum + day.count, 0);

  return {
    configured: true,
    username,
    source: 'rest',
    dailyCommits: days,
    totals: { commits: totalCommits, pullRequests, issues },
  };
}
