import { useState } from 'react';
import type { TaskKind } from '../api';

interface QuickAddPopoverProps {
  onCapture: (text: string, kind?: TaskKind) => Promise<void>;
  onClose: () => void;
}

export function QuickAddPopover({ onCapture, onClose }: QuickAddPopoverProps) {
  const [draft, setDraft] = useState('');
  const [kindOverride, setKindOverride] = useState<TaskKind | 'auto'>('auto');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCapture(draft.trim(), kindOverride === 'auto' ? undefined : kindOverride);
      setDraft('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="quick-add-popover">
      <p className="eyebrow">Quick Add</p>
      <div className="task-input-row">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder='"submit report friday 5pm" or just a to-do'
        />
        <button className="action-button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '…' : 'Add'}
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
    </div>
  );
}
