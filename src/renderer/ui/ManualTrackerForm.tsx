import { useState } from 'react';

interface ManualTrackerFormProps {
  onSubmit: (name: string, unit: string) => void;
  onCancel: () => void;
}

export function ManualTrackerForm({ onSubmit, onCancel }: ManualTrackerFormProps) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');

  return (
    <form
      className="add-tracker-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onSubmit(name.trim(), unit.trim());
        setName('');
        setUnit('');
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tracker name (e.g. Reading)" required autoFocus />
      <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit (e.g. pages)" />
      <button className="action-button" type="submit">
        Add
      </button>
      <button type="button" className="ghost-button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
