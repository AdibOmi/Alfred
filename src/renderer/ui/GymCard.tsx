import { useState, type FormEvent } from 'react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { GymLog, GymSummary } from '../api';
import { localDateString } from '../../shared/date';

interface GymCardProps {
  logs: GymLog[];
  summary: GymSummary | null;
  loading: boolean;
  onAdd: (payload: { date: string; exercise: string; sets: number; reps: number; weight?: number }) => Promise<void>;
  onDelete: (id: string) => void;
}

export function GymCard({ logs, summary, loading, onAdd, onDelete }: GymCardProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const exercise = String(data.get('exercise') ?? '').trim();
    const sets = Number(data.get('sets'));
    const reps = Number(data.get('reps'));
    const weightRaw = data.get('weight');
    const date = String(data.get('date') ?? localDateString());
    if (!exercise || !sets || !reps) return;

    setSubmitting(true);
    try {
      await onAdd({ date, exercise, sets, reps, weight: weightRaw ? Number(weightRaw) : undefined });
      form.reset();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="chart-card">
      <h3>Gym</h3>
      {loading && <p className="hint-text">Loading…</p>}
      {!loading && (
        <>
          <div className="metric-row">
            <div className="metric-mini">
              <strong>{summary?.streak ?? 0}</strong>
              <span>day streak</span>
            </div>
            <div className="metric-mini">
              <strong>{summary?.totalEntries ?? 0}</strong>
              <span>logged sets</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={summary?.weeklyVolume ?? []}>
              <CartesianGrid stroke="#14213d" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#9bb7e7', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fill: '#9bb7e7', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ background: '#050b18', border: '1px solid #1af4ff' }} itemStyle={{ color: '#fff' }} />
              <Bar dataKey="volume" fill="#1af4ff" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <form className="gym-form" onSubmit={handleSubmit}>
            <input name="date" type="date" defaultValue={localDateString()} required />
            <input name="exercise" placeholder="Exercise" required />
            <input name="sets" type="number" min={1} placeholder="Sets" required />
            <input name="reps" type="number" min={1} placeholder="Reps" required />
            <input name="weight" type="number" min={0} step="0.5" placeholder="Weight (optional)" />
            <button className="action-button" type="submit" disabled={submitting}>
              Log set
            </button>
          </form>

          {logs.length > 0 && (
            <div className="gym-log-list">
              {logs.slice(0, 5).map((log) => (
                <div key={log.id} className="gym-log-row">
                  <span>
                    {log.exercise} — {log.sets}×{log.reps}
                    {log.weight ? ` @ ${log.weight}` : ''}
                  </span>
                  <button className="ghost-button icon-button" onClick={() => onDelete(log.id)} aria-label="Delete entry">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
