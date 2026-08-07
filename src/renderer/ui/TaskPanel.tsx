import { useState } from 'react';
import type { Task } from '../api';
import { getUrgency, formatDue } from '../utils';

interface TaskPanelProps {
  tasks: Task[];
  loading: boolean;
  onCapture: (text: string) => Promise<void>;
  onToggleDone: (task: Task) => void;
  onDelete: (id: string) => void;
}

export function TaskPanel({ tasks, loading, onCapture, onToggleDone, onDelete }: TaskPanelProps) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const active = tasks.filter((task) => task.status === 'active').sort((a, b) => a.due.localeCompare(b.due));
  const done = tasks.filter((task) => task.status === 'done').slice(0, 5);

  const handleSubmit = async () => {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCapture(draft.trim());
      setDraft('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <div className="panel-header">
        <div>
          <p className="eyebrow">Reminders</p>
          <h2>Deadline timeline</h2>
        </div>
      </div>
      <div className="task-input-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder='Try "submit report friday 5pm"'
        />
        <button className="action-button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Logging…' : 'Log'}
        </button>
      </div>

      {loading ? (
        <p className="hint-text">Loading tasks…</p>
      ) : active.length === 0 ? (
        <p className="hint-text">No open reminders. Systems quiet.</p>
      ) : (
        <div className="task-list">
          {active.map((task) => (
            <div key={task.id} className={`task-card urgency-${getUrgency(task.due)}`}>
              <label className="task-check">
                <input type="checkbox" checked={false} onChange={() => onToggleDone(task)} />
                <span>{task.title}</span>
              </label>
              <div className="task-meta">
                <small>{formatDue(task.due)}</small>
                <button className="ghost-button icon-button" onClick={() => onDelete(task.id)} aria-label="Delete task">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="task-done-list">
          <p className="eyebrow">Recently completed</p>
          {done.map((task) => (
            <div key={task.id} className="task-done-row">
              <span>{task.title}</span>
              <button className="ghost-button icon-button" onClick={() => onDelete(task.id)} aria-label="Delete task">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
