import { useCallback, useEffect, useState } from 'react';
import { api, type GithubProgress, type LeetcodeProgress, type GymLog, type GymSummary } from '../api';
import { GithubCard } from './GithubCard';
import { LeetcodeCard } from './LeetcodeCard';
import { GymCard } from './GymCard';

const REFRESH_MS = 5 * 60 * 1000;

export function ProgressPanel() {
  const [github, setGithub] = useState<GithubProgress | null>(null);
  const [leetcode, setLeetcode] = useState<LeetcodeProgress | null>(null);
  const [gymLogs, setGymLogs] = useState<GymLog[]>([]);
  const [gymSummary, setGymSummary] = useState<GymSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [githubResult, leetcodeResult, gymLogsResult, gymSummaryResult] = await Promise.allSettled([
      api.getGithubProgress(),
      api.getLeetcodeProgress(),
      api.getGymLogs(),
      api.getGymSummary(),
    ]);
    if (githubResult.status === 'fulfilled') setGithub(githubResult.value);
    if (leetcodeResult.status === 'fulfilled') setLeetcode(leetcodeResult.value);
    if (gymLogsResult.status === 'fulfilled') setGymLogs(gymLogsResult.value.logs);
    if (gymSummaryResult.status === 'fulfilled') setGymSummary(gymSummaryResult.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleAddGymLog = async (payload: { date: string; exercise: string; sets: number; reps: number; weight?: number }) => {
    await api.createGymLog(payload);
    const [logs, summary] = await Promise.all([api.getGymLogs(), api.getGymSummary()]);
    setGymLogs(logs.logs);
    setGymSummary(summary);
  };

  const handleDeleteGymLog = async (id: string) => {
    await api.deleteGymLog(id);
    const [logs, summary] = await Promise.all([api.getGymLogs(), api.getGymSummary()]);
    setGymLogs(logs.logs);
    setGymSummary(summary);
  };

  return (
    <section>
      <div className="panel-header">
        <div>
          <p className="eyebrow">Progress</p>
          <h2>Activity snapshot</h2>
        </div>
      </div>
      <div className="progress-grid-three">
        <GithubCard progress={github} loading={loading} />
        <LeetcodeCard progress={leetcode} loading={loading} />
        <GymCard logs={gymLogs} summary={gymSummary} loading={loading} onAdd={handleAddGymLog} onDelete={handleDeleteGymLog} />
      </div>
    </section>
  );
}
