import { useEffect, useState } from 'react';
import { api, type GithubProgress, type LeetcodeProgress, type Tracker } from '../api';

export interface DevGlance {
  loading: boolean;
  github: GithubProgress | null;
  leetcode: LeetcodeProgress | null;
  githubTracker: Tracker | null;
  leetcodeTracker: Tracker | null;
}

const EMPTY: DevGlance = { loading: true, github: null, leetcode: null, githubTracker: null, leetcodeTracker: null };

export function useDevGlance(): DevGlance {
  const [state, setState] = useState<DevGlance>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { trackers } = await api.getTrackers();
      const githubTracker = trackers.find((t) => t.type === 'github' && t.enabled) ?? null;
      const leetcodeTracker = trackers.find((t) => t.type === 'leetcode' && t.enabled) ?? null;
      const [githubResult, leetcodeResult] = await Promise.allSettled([
        githubTracker ? api.getGithubProgress() : Promise.resolve(null),
        leetcodeTracker ? api.getLeetcodeProgress() : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setState({
        loading: false,
        github: githubResult.status === 'fulfilled' ? githubResult.value : null,
        leetcode: leetcodeResult.status === 'fulfilled' ? leetcodeResult.value : null,
        githubTracker,
        leetcodeTracker,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
