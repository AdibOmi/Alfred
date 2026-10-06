import { useState, type FormEvent } from 'react';
import type { AppState, Result } from '../../electron/preload';
import { call } from '../bridge';

interface SettingsPanelProps {
  state: AppState;
  onChanged: (state: AppState) => void;
  onBack: () => void;
}

export function SettingsPanel({ state, onChanged, onBack }: SettingsPanelProps) {
  const [server, setServer] = useState(state.apiBase);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = async (change: Promise<Result<AppState>>) => {
    setError(null);
    try {
      onChanged(await call(change));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const saveServer = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(await apply(window.alfred.setApiBase(server)));
  };

  return (
    <div className="settings-panel">
      <div className="panel-header-row">
        <h2>Settings</h2>
        <button className="icon-button" onClick={onBack} aria-label="Back">
          ✕
        </button>
      </div>

      {state.user && (
        <p className="hint-text">
          Signed in as <b>{state.user.name}</b> ({state.user.email})
        </p>
      )}

      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={state.moveRealCursor}
          disabled={!state.canMoveCursor}
          onChange={(e) => apply(window.alfred.setMoveRealCursor(e.target.checked))}
        />
        <span>
          Glide my real mouse pointer to the target
          <small className="hint-text block">
            {state.canMoveCursor ? 'Alfred never clicks for you.' : 'Only available on Windows.'}
          </small>
        </span>
      </label>

      {state.user && (
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={state.user.weekly_report}
            onChange={(e) => apply(window.alfred.setWeeklyReport(e.target.checked))}
          />
          <span>Email me a weekly “what you learned” report</span>
        </label>
      )}

      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={state.autoLaunch}
          onChange={(e) => apply(window.alfred.setAutoLaunch(e.target.checked))}
        />
        <span>Launch Alfred at login</span>
      </label>

      <form className="settings-form" onSubmit={saveServer}>
        <label className="settings-field">
          <span>Server URL</span>
          <div className="task-add-row">
            <input
              value={server}
              onChange={(e) => {
                setServer(e.target.value);
                setSaved(false);
              }}
            />
            <button className="ghost-button" type="submit" disabled={server.trim() === state.apiBase}>
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </label>
      </form>

      <div className="task-add-row">
        <button className="ghost-button" onClick={() => window.alfred.resetIconPosition()}>
          Reset icon position
        </button>
        {state.user && (
          <button className="ghost-button danger" onClick={() => apply(window.alfred.logout())}>
            Sign out
          </button>
        )}
      </div>

      {error && <p className="hint-text hint-error">{error}</p>}

      <p className="hint-text privacy-note">
        Press <b>Ctrl/Cmd + Shift + A</b> anywhere to summon Alfred. A screenshot is taken only when a question needs
        one, sent to the AI to find the next step, and never saved. Tasks and history are stored with your account.
      </p>
    </div>
  );
}
