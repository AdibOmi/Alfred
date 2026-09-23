import { useMemo, useState, type FormEvent } from 'react';
import type { Task } from '../../shared/tasks';
import { describeDue, toDateTimeLocalValue } from '../../shared/format';

interface TasksPanelProps {
  tasks: Task[];
  onOpenSettings: () => void;
  onClose: () => void;
}

function DueBadge({ remindAt }: { remindAt: string }) {
  // Recomputed on every render rather than memoised: the panel only lives while
  // it is open, and a stale "Today 5:00 PM" on a reminder that just passed is
  // worse than the trivial cost of re-deriving it.
  const due = describeDue(remindAt, new Date());
  if (!due.label) return null;
  return <span className={`due-badge due-${due.kind}`}>{due.label}</span>;
}

function TaskRow({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const [remindValue, setRemindValue] = useState(() => toDateTimeLocalValue(task.remindAt));

  const saveReminder = async () => {
    await window.alfred.updateTask(task.id, { remindAt: remindValue || null });
    setEditing(false);
  };

  return (
    <li className={`task-row ${task.done ? 'done' : ''}`}>
      <label className="task-main">
        <input
          type="checkbox"
          checked={task.done}
          onChange={(event) => window.alfred.updateTask(task.id, { done: event.target.checked })}
        />
        <span className="task-text">
          <span className="task-title">{task.title}</span>
          {task.notes && <span className="task-notes">{task.notes}</span>}
          {task.remindAt && !task.done && <DueBadge remindAt={task.remindAt} />}
        </span>
      </label>

      <div className="task-actions">
        <button
          className="icon-button"
          onClick={() => {
            setRemindValue(toDateTimeLocalValue(task.remindAt));
            setEditing((open) => !open);
          }}
          aria-label={task.remindAt ? 'Change reminder' : 'Add reminder'}
          title={task.remindAt ? 'Change reminder' : 'Add reminder'}
        >
          ⏰
        </button>
        <button
          className="icon-button"
          onClick={() => window.alfred.deleteTask(task.id)}
          aria-label="Delete task"
          title="Delete task"
        >
          ✕
        </button>
      </div>

      {editing && (
        <div className="task-reminder-editor">
          <input
            type="datetime-local"
            value={remindValue}
            onChange={(event) => setRemindValue(event.target.value)}
            aria-label="Reminder time"
          />
          <button className="action-button small" onClick={saveReminder}>
            Save
          </button>
          {task.remindAt && (
            <button
              className="ghost-button small"
              onClick={async () => {
                await window.alfred.updateTask(task.id, { remindAt: null });
                setRemindValue('');
                setEditing(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function TasksPanel({ tasks, onOpenSettings, onClose }: TasksPanelProps) {
  const [title, setTitle] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [showDone, setShowDone] = useState(false);

  const open = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  const done = useMemo(() => tasks.filter((task) => task.done), [tasks]);
  const visible = showDone ? done : open;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle('');
    setRemindAt('');
    await window.alfred.createTask({ title: text, remindAt: remindAt || null });
  };

  return (
    <div className="tasks-panel">
      <div className="panel-header-row">
        <h2>Tasks</h2>
        <div className="panel-header-actions">
          <button className="icon-button" onClick={onOpenSettings} aria-label="Settings">
            ⚙
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="tasks-filter-row">
        <button className={`chip ${!showDone ? 'chip-active' : ''}`} onClick={() => setShowDone(false)}>
          Open {open.length > 0 && <span className="chip-count">{open.length}</span>}
        </button>
        <button className={`chip ${showDone ? 'chip-active' : ''}`} onClick={() => setShowDone(true)}>
          Done {done.length > 0 && <span className="chip-count">{done.length}</span>}
        </button>
        {showDone && done.length > 0 && (
          <button className="ghost-button small clear-done" onClick={() => window.alfred.clearCompletedTasks()}>
            Clear
          </button>
        )}
      </div>

      <div className="tasks-list-window">
        {visible.length === 0 && (
          <p className="hint-text">
            {showDone
              ? 'Nothing finished yet.'
              : 'No open tasks. Add one below, or just tell Alfred in the chat: “remind me to call the bank at 4pm”.'}
          </p>
        )}
        <ul className="task-list">
          {visible.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      </div>

      <form className="task-add-form" onSubmit={handleSubmit}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task…"
          autoComplete="off"
          aria-label="Task title"
        />
        <div className="task-add-row">
          <input
            type="datetime-local"
            value={remindAt}
            onChange={(event) => setRemindAt(event.target.value)}
            aria-label="Remind me at"
          />
          <button className="action-button" type="submit" disabled={!title.trim()}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
