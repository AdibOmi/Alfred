import { useState, type FormEvent } from 'react';

interface SettingsPanelProps {
  firstRun: boolean;
  autoLaunch: boolean;
  onSaved: (hasApiKey: boolean) => void;
  onBack?: () => void;
}

export function SettingsPanel({ firstRun, autoLaunch, onSaved, onBack }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLaunchChecked, setAutoLaunchChecked] = useState(autoLaunch);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await window.alfred.setApiKey(apiKey.trim());
      setApiKey('');
      onSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAutoLaunchToggle = async (checked: boolean) => {
    setAutoLaunchChecked(checked);
    await window.alfred.setAutoLaunch(checked);
  };

  const handleResetPosition = () => {
    window.alfred.resetIconPosition();
  };

  return (
    <div className="settings-panel">
      <div className="panel-header-row">
        <h2>{firstRun ? 'Set up Alfred' : 'Settings'}</h2>
        {!firstRun && onBack && (
          <button className="icon-button" onClick={onBack} aria-label="Back to chat">
            ✕
          </button>
        )}
      </div>

      {firstRun && <p className="hint-text">Add a Claude API key to start asking Alfred questions about your screen.</p>}

      <form onSubmit={handleSubmit} className="settings-form">
        <label className="settings-field">
          <span>Anthropic API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            autoFocus
          />
        </label>
        {error && <p className="hint-text hint-error">{error}</p>}
        <button className="action-button" type="submit" disabled={saving || !apiKey.trim()}>
          {saving ? 'Saving…' : 'Save key'}
        </button>
      </form>

      {!firstRun && (
        <>
          <label className="settings-toggle-row">
            <input type="checkbox" checked={autoLaunchChecked} onChange={(e) => handleAutoLaunchToggle(e.target.checked)} />
            <span>Launch Alfred at login</span>
          </label>

          <button className="ghost-button" onClick={handleResetPosition}>
            Reset icon position
          </button>
        </>
      )}

      <p className="hint-text privacy-note">
        Screenshots are taken only when you ask a question, are sent straight to Claude, and are never saved to
        disk or kept in memory afterward.
      </p>
    </div>
  );
}
