import { useCallback, useEffect, useState } from 'react';
import { api, type Tracker } from '../api';
import { ManualTrackerCard } from './ManualTrackerCard';
import { ManualTrackerForm } from './ManualTrackerForm';
import { TrackerManager } from './TrackerManager';

const TYPES: Tracker['type'][] = ['manual'];

export function ManualTrackersSection() {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [managing, setManaging] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { trackers: fetched } = await api.getTrackers();
    setTrackers(fetched.filter((t) => TYPES.includes(t.type)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enabled = trackers.filter((t) => t.enabled).sort((a, b) => a.position - b.position);

  const handleAdd = async (name: string, unit: string) => {
    try {
      setError(null);
      await api.createTracker({ type: 'manual', name, unit: unit || undefined });
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <div className="panel-header-actions" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="ghost-button" onClick={() => setManaging((v) => !v)}>
          {managing ? 'Done' : 'Manage'}
        </button>
      </div>

      {error && <p className="hint-text hint-error">{error}</p>}
      {managing && (
        <TrackerManager trackers={trackers} filterTypes={TYPES} onRefresh={refresh} onClose={() => setManaging(false)} />
      )}

      <div className="progress-grid-three">
        {enabled.map((tracker) => (
          <ManualTrackerCard key={tracker.id} tracker={tracker} />
        ))}
        <button type="button" className="add-tracker-tile" onClick={() => setShowForm((v) => !v)}>
          <span className="add-tracker-tile-icon">+</span>
          <span>Add manual tracker</span>
        </button>
      </div>
      {showForm && <ManualTrackerForm onSubmit={handleAdd} onCancel={() => setShowForm(false)} />}
    </>
  );
}
