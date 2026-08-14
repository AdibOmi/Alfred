import { useState } from 'react';
import { api, type Tracker } from '../api';

interface TrackerManagerProps {
  trackers: Tracker[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
  filterTypes?: Tracker['type'][];
}

export function TrackerManager({ trackers, onRefresh, onClose, filterTypes }: TrackerManagerProps) {
  const [error, setError] = useState<string | null>(null);
  const scoped = filterTypes ? trackers.filter((t) => filterTypes.includes(t.type)) : trackers;
  const sorted = [...scoped].sort((a, b) => a.position - b.position);

  const guard = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleToggle = (tracker: Tracker) => guard(() => api.updateTracker(tracker.id, { enabled: !tracker.enabled }));

  const handleMove = (tracker: Tracker, direction: 'up' | 'down') => guard(() => api.moveTracker(tracker.id, direction));

  const handleRename = (tracker: Tracker) => {
    const name = window.prompt('Rename tracker', tracker.name);
    if (name === null || !name.trim()) return;
    guard(() => api.updateTracker(tracker.id, { name: name.trim() }));
  };

  const handleDelete = (tracker: Tracker) => {
    const message =
      tracker.type === 'manual'
        ? `Delete "${tracker.name}" and all its logged entries? This can't be undone.`
        : `Remove the ${tracker.name} tracker from your dashboard?`;
    if (!window.confirm(message)) return;
    guard(() => api.deleteTracker(tracker.id));
  };

  return (
    <div className="tracker-manager">
      {error && <p className="hint-text hint-error">{error}</p>}

      <div className="tracker-manager-list">
        {sorted.length === 0 && (
          <p className="hint-text">No trackers yet — use the + tiles below to connect an integration or add a manual tracker.</p>
        )}
        {sorted.map((tracker, index) => (
          <div key={tracker.id} className={`tracker-manager-row${tracker.enabled ? '' : ' disabled'}`}>
            <label className="tracker-toggle">
              <input type="checkbox" checked={tracker.enabled} onChange={() => handleToggle(tracker)} />
              <span>{tracker.name}</span>
              <small className="tracker-type-badge">{tracker.type}</small>
            </label>
            <div className="tracker-manager-actions">
              <button className="ghost-button icon-button" onClick={() => handleMove(tracker, 'up')} disabled={index === 0} aria-label="Move up">
                ↑
              </button>
              <button
                className="ghost-button icon-button"
                onClick={() => handleMove(tracker, 'down')}
                disabled={index === sorted.length - 1}
                aria-label="Move down"
              >
                ↓
              </button>
              <button className="ghost-button icon-button" onClick={() => handleRename(tracker)} aria-label="Rename tracker">
                ✎
              </button>
              <button className="ghost-button icon-button" onClick={() => handleDelete(tracker)} aria-label="Delete tracker">
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="ghost-button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
