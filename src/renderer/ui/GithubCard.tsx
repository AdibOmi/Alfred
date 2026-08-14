import { AreaChart, Area, ResponsiveContainer, Tooltip, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { GithubProgress } from '../api';

interface GithubCardProps {
  title: string;
  progress: GithubProgress | null;
  loading: boolean;
}

export function GithubCard({ title, progress, loading }: GithubCardProps) {
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {loading && <p className="hint-text">Loading…</p>}
      {!loading && !progress?.configured && (
        <p className="hint-text">Set GITHUB_USERNAME in your .env to track commit activity here.</p>
      )}
      {!loading && progress?.configured && progress.error && <p className="hint-text hint-error">{progress.error}</p>}
      {!loading && progress?.configured && !progress.error && (
        <>
          <div className="metric-row">
            <div className="metric-mini">
              <strong>{progress.totals?.commits ?? 0}</strong>
              <span>commits</span>
            </div>
            <div className="metric-mini">
              <strong>{progress.totals?.pullRequests ?? 0}</strong>
              <span>PRs</span>
            </div>
            <div className="metric-mini">
              <strong>{progress.totals?.issues ?? 0}</strong>
              <span>issues</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={progress.dailyCommits ?? []}>
              <defs>
                <linearGradient id="commitGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c7cbd1" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#c7cbd1" stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1c1c20" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#7d7d87', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fill: '#7d7d87', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
              <Tooltip contentStyle={{ background: '#101013', border: '1px solid #c7cbd1' }} itemStyle={{ color: '#fff' }} />
              <Area type="monotone" dataKey="count" stroke="#c7cbd1" fillOpacity={1} fill="url(#commitGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
