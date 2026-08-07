import { BarChart, Bar, ResponsiveContainer, Tooltip, CartesianGrid, XAxis, YAxis, Cell } from 'recharts';
import type { LeetcodeProgress } from '../api';

interface LeetcodeCardProps {
  progress: LeetcodeProgress | null;
  loading: boolean;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: '#3ddc97',
  medium: '#fefefe',
  hard: '#ff5c7a',
};

export function LeetcodeCard({ progress, loading }: LeetcodeCardProps) {
  return (
    <div className="chart-card">
      <h3>LeetCode</h3>
      {loading && <p className="hint-text">Loading…</p>}
      {!loading && !progress?.configured && (
        <p className="hint-text">Set LEETCODE_USERNAME in your .env to track problem-solving activity here.</p>
      )}
      {!loading && progress?.configured && progress.error && <p className="hint-text hint-error">{progress.error}</p>}
      {!loading && progress?.configured && !progress.error && (
        <>
          <div className="metric-row">
            <div className="metric-mini">
              <strong>{progress.difficulty?.total ?? 0}</strong>
              <span>solved</span>
            </div>
            <div className="metric-mini">
              <strong>{progress.streak ?? 0}</strong>
              <span>day streak</span>
            </div>
            <div className="metric-mini">
              <strong>{progress.totalActiveDays ?? 0}</strong>
              <span>active days</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart
              layout="vertical"
              data={[
                { name: 'Easy', value: progress.difficulty?.easy ?? 0, key: 'easy' },
                { name: 'Medium', value: progress.difficulty?.medium ?? 0, key: 'medium' },
                { name: 'Hard', value: progress.difficulty?.hard ?? 0, key: 'hard' },
              ]}
              margin={{ left: 8, right: 8 }}
            >
              <CartesianGrid stroke="#14213d" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#9bb7e7', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#9bb7e7', fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
              <Tooltip contentStyle={{ background: '#050b18', border: '1px solid #1af4ff' }} itemStyle={{ color: '#fff' }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {['easy', 'medium', 'hard'].map((key) => (
                  <Cell key={key} fill={DIFFICULTY_COLORS[key]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
