import { Router } from 'express';
import { withCache } from '../cache';
import { localDateString } from '../../shared/date';

const CACHE_TTL_MS = 5 * 60 * 1000;
const LEETCODE_GRAPHQL_URL = 'https://leetcode.com/graphql';

interface LeetcodeGraphQLResponse {
  data?: {
    matchedUser?: {
      submitStats: { acSubmissionNum: { difficulty: string; count: number }[] };
      userCalendar?: { streak: number; totalActiveDays: number; submissionCalendar?: string };
    };
  };
}

interface LeetcodeProgress {
  configured: boolean;
  username?: string;
  difficulty?: { easy: number; medium: number; hard: number; total: number };
  streak?: number;
  totalActiveDays?: number;
  recentActivity?: { date: string; count: number }[];
  error?: string;
}

export function leetcodeRouter(getUsername: () => string | undefined) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const username = getUsername();
    if (!username) return res.json({ configured: false } satisfies LeetcodeProgress);

    try {
      const data = await withCache(`leetcode:${username}`, CACHE_TTL_MS, () => fetchLeetcodeStats(username));
      res.json(data);
    } catch (error) {
      res.json({ configured: true, username, error: (error as Error).message } satisfies LeetcodeProgress);
    }
  });

  return router;
}

async function fetchLeetcodeStats(username: string): Promise<LeetcodeProgress> {
  const query = `
    query userProgress($username: String!) {
      matchedUser(username: $username) {
        username
        submitStats: submitStatsGlobal {
          acSubmissionNum { difficulty count }
        }
        userCalendar {
          streak
          totalActiveDays
          submissionCalendar
        }
      }
    }
  `;

  const response = await fetch(LEETCODE_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://leetcode.com',
      'User-Agent': 'Mozilla/5.0 (compatible; Alfred-Assistant/1.0)',
    },
    body: JSON.stringify({ query, variables: { username } }),
  });

  if (!response.ok) throw new Error(`LeetCode API error: ${response.status}`);
  const json = (await response.json()) as LeetcodeGraphQLResponse;
  const user = json.data?.matchedUser;
  if (!user) throw new Error(`LeetCode user "${username}" not found`);

  const breakdown: Record<string, number> = {};
  for (const entry of user.submitStats.acSubmissionNum) {
    breakdown[entry.difficulty.toLowerCase()] = entry.count;
  }

  const calendar = user.userCalendar ?? { streak: 0, totalActiveDays: 0, submissionCalendar: undefined };
  const submissionCalendar: Record<string, number> = calendar.submissionCalendar
    ? JSON.parse(calendar.submissionCalendar)
    : {};

  const recentActivity: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    day.setHours(0, 0, 0, 0);
    const dayStartSeconds = Math.floor(day.getTime() / 1000);
    // LeetCode buckets by UTC day-start timestamps; find the matching key within the day's window.
    const count =
      Object.entries(submissionCalendar).find(([ts]) => {
        const seconds = Number(ts);
        return seconds >= dayStartSeconds && seconds < dayStartSeconds + 86400;
      })?.[1] ?? 0;
    recentActivity.push({ date: localDateString(day), count });
  }

  return {
    configured: true,
    username,
    difficulty: {
      easy: breakdown.easy ?? 0,
      medium: breakdown.medium ?? 0,
      hard: breakdown.hard ?? 0,
      total: breakdown.all ?? 0,
    },
    streak: calendar.streak ?? 0,
    totalActiveDays: calendar.totalActiveDays ?? 0,
    recentActivity,
  };
}
