import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, CartesianGrid, XAxis, YAxis } from 'recharts';
import { api, type Tracker, type TrackerLog, type TrackerSummary } from '../api';
import { localDateString } from '../../shared/date';

interface ManualTrackerCardProps {
  tracker: Tracker;
}

export function ManualTrackerCard({ tracker }: ManualTrackerCardProps) {
  const [logs, setLogs] = useState<TrackerLog[]>([]);
  const [summary, setSummary] = useState<TrackerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    const [logsResult, summaryResult] = await Promise.all([api.getTrackerLogs(tracker.id), api.getTrackerSummary(tracker.id)]);
    setLogs(logsResult.logs);
    setSummary(summaryResult);
    setLoading(false);
  }, [tracker.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const unit = tracker.unit || 'entries';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const date = String(data.get('date') ?? localDateString());
    const label = String(data.get('label') ?? '').trim();
    const value = Number(data.get('value'));
    if (!date || Number.isNaN(value)) return;

    setSubmitting(true);
    try {
      await api.createTrackerLog(tracker.id, { date, label: label || undefined, value });
      form.reset();
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.deleteTrackerLog(tracker.id, id);
    await refresh();
  };

  return (
    <div className="chart-card">
      <h3>{tracker.name}</h3>
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
              <span>logged</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={summary?.series ?? []}>
              <CartesianGrid stroke="#1c1c20" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#7d7d87', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fill: '#7d7d87', fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ background: '#101013', border: '1px solid #c7cbd1' }} itemStyle={{ color: '#fff' }} />
              <Bar dataKey="value" fill="#c7cbd1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          <form className="tracker-log-form" onSubmit={handleSubmit}>
            <input name="date" type="date" defaultValue={localDateString()} required />
            <input name="label" placeholder="Label (optional)" />
            <input name="value" type="number" step="0.5" placeholder={`Value (${unit})`} required />
            <button className="action-button" type="submit" disabled={submitting}>
              Log entry
            </button>
          </form>

          {logs.length > 0 && (
            <div className="tracker-log-list">
              {logs.slice(0, 5).map((log) => (
                <div key={log.id} className="tracker-log-row">
                  <span>
                    {log.label ? `${log.label} — ` : ''}
                    {log.value} {unit}
                  </span>
                  <button className="ghost-button icon-button" onClick={() => handleDelete(log.id)} aria-label="Delete entry">
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
