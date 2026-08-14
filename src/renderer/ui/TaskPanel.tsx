import { useState } from 'react';
import type { Task, TaskKind } from '../api';
import { getUrgency, formatDue, sortByDueThenCreated } from '../utils';

interface TaskPanelProps {
  tasks: Task[];
  loading: boolean;
  onCapture: (text: string, kind?: TaskKind) => Promise<void>;
  onToggleDone: (task: Task) => void;
  onDelete: (id: string) => void;
}

function TaskRow({ task, onToggleDone, onDelete }: { task: Task; onToggleDone: (task: Task) => void; onDelete: (id: string) => void }) {
  return (
    <div className={`task-card ${task.due ? `urgency-${getUrgency(task.due)}` : ''}`}>
      <label className="task-check">
        <input type="checkbox" checked={false} onChange={() => onToggleDone(task)} />
        <span>{task.title}</span>
      </label>
      <div className="task-meta">
        {task.due && <small>{formatDue(task.due)}</small>}
        <button className="ghost-button icon-button" onClick={() => onDelete(task.id)} aria-label="Delete task">
          ✕
        </button>
      </div>
    </div>
  );
}

export function TaskPanel({ tasks, loading, onCapture, onToggleDone, onDelete }: TaskPanelProps) {
  const [draft, setDraft] = useState('');
  const [kindOverride, setKindOverride] = useState<TaskKind | 'auto'>('auto');
  const [submitting, setSubmitting] = useState(false);

  const active = tasks.filter((task) => task.status === 'active');
  const deadlines = sortByDueThenCreated(active.filter((task) => task.kind === 'deadline'));
  const todos = sortByDueThenCreated(active.filter((task) => task.kind === 'todo'));
  const done = tasks.filter((task) => task.status === 'done').slice(0, 5);

  const handleSubmit = async () => {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCapture(draft.trim(), kindOverride === 'auto' ? undefined : kindOverride);
      setDraft('');
      setKindOverride('auto');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <div className="task-input-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder='Try "submit report friday 5pm" or just "buy groceries"'
        />
        <button className="action-button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Logging…' : 'Log'}
        </button>
      </div>
      <div className="kind-toggle" role="group" aria-label="Task kind">
        {(['auto', 'deadline', 'todo'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={`ghost-button icon-button ${kindOverride === option ? 'active' : ''}`}
            onClick={() => setKindOverride(option)}
          >
            {option === 'auto' ? 'Auto-detect' : option === 'deadline' ? 'Deadline' : 'To-do'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="hint-text">Loading tasks…</p>
      ) : (
        <>
          <div className="panel-section">
            <p className="eyebrow">Deadlines</p>
            {deadlines.length === 0 ? (
              <p className="hint-text">Nothing on the horizon.</p>
            ) : (
              <div className="task-list">
                {deadlines.map((task) => (
                  <TaskRow key={task.id} task={task} onToggleDone={onToggleDone} onDelete={onDelete} />
                ))}
              </div>
            )}
          </div>

          <div className="panel-section">
            <p className="eyebrow">To-do</p>
            {todos.length === 0 ? (
              <p className="hint-text">Nothing on the list.</p>
            ) : (
              <div className="task-list">
                {todos.map((task) => (
                  <TaskRow key={task.id} task={task} onToggleDone={onToggleDone} onDelete={onDelete} />
                ))}
              </div>
            )}
          </div>
        </>
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
