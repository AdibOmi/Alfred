import { useCallback, useEffect, useState } from 'react';
import { api, type GithubProgress, type LeetcodeProgress, type Tracker } from '../api';
import { GithubCard } from './GithubCard';
import { LeetcodeCard } from './LeetcodeCard';
import { TrackerManager } from './TrackerManager';

const REFRESH_MS = 5 * 60 * 1000;
const TYPES: Tracker['type'][] = ['github', 'leetcode'];

function AddTrackerTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="add-tracker-tile" onClick={onClick}>
      <span className="add-tracker-tile-icon">+</span>
      <span>{label}</span>
    </button>
  );
}

export function CodingLogSection() {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [github, setGithub] = useState<GithubProgress | null>(null);
  const [leetcode, setLeetcode] = useState<LeetcodeProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { trackers: fetched } = await api.getTrackers();
    setTrackers(fetched.filter((t) => TYPES.includes(t.type)));

    const wants = (type: Tracker['type']) => fetched.some((t) => t.type === type);
    const [githubResult, leetcodeResult] = await Promise.allSettled([
      wants('github') ? api.getGithubProgress() : Promise.resolve(null),
      wants('leetcode') ? api.getLeetcodeProgress() : Promise.resolve(null),
    ]);
    if (githubResult.status === 'fulfilled') setGithub(githubResult.value);
    if (leetcodeResult.status === 'fulfilled') setLeetcode(leetcodeResult.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const enabled = trackers.filter((t) => t.enabled).sort((a, b) => a.position - b.position);
  const hasGithub = trackers.some((t) => t.type === 'github');
  const hasLeetcode = trackers.some((t) => t.type === 'leetcode');

  const handleConnect = async (type: 'github' | 'leetcode') => {
    try {
      setError(null);
      await api.createTracker({ type });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Coding Log</p>
          <h2>GitHub, LeetCode &amp; prep</h2>
        </div>
        <div className="panel-header-actions">
          <button className="ghost-button" onClick={() => setManaging((v) => !v)}>
            {managing ? 'Done' : 'Manage'}
          </button>
        </div>
      </div>

      {error && <p className="hint-text hint-error">{error}</p>}
      {managing && (
        <TrackerManager trackers={trackers} filterTypes={TYPES} onRefresh={refresh} onClose={() => setManaging(false)} />
      )}

      <div className="progress-grid-three">
        {enabled.map((tracker) =>
          tracker.type === 'github' ? (
            <GithubCard key={tracker.id} title={tracker.name} progress={github} loading={loading} />
          ) : (
            <LeetcodeCard key={tracker.id} title={tracker.name} progress={leetcode} loading={loading} />
          ),
        )}
        {!hasGithub && <AddTrackerTile label="Connect GitHub" onClick={() => handleConnect('github')} />}
        {!hasLeetcode && <AddTrackerTile label="Connect LeetCode" onClick={() => handleConnect('leetcode')} />}
        <div className="chart-card">
          <h3>Prep</h3>
          <p className="hint-text">
            A topic checklist (DSA, system design, CS fundamentals) with per-topic status and notes lands here in a
            future update.
          </p>
        </div>
      </div>
    </section>
  );
}
