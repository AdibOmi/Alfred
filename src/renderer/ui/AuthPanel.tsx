import { useState, type FormEvent } from 'react';
import type { AppState } from '../../electron/preload';
import { call } from '../bridge';

interface AuthPanelProps {
  apiBase: string;
  onSignedIn: (state: AppState) => void;
  onClose: () => void;
}

export function AuthPanel({ apiBase, onSignedIn, onClose }: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(apiBase);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (server.trim() !== apiBase) await call(window.alfred.setApiBase(server));
      const state =
        mode === 'signup'
          ? await call(window.alfred.signup(name.trim() || 'Friend', email.trim(), password))
          : await call(window.alfred.login(email.trim(), password));
      setPassword('');
      onSignedIn(state);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-panel">
      <div className="panel-header-row">
        <h2>{mode === 'signup' ? 'Create your account' : 'Sign in to Alfred'}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <p className="hint-text">
        Alfred looks at your screen and points at the next thing to click, one step at a time. Your account keeps
        your tasks, history and weekly report.
      </p>

      <div className="tasks-filter-row">
        <button className={`chip ${mode === 'login' ? 'chip-active' : ''}`} onClick={() => setMode('login')}>
          Sign in
        </button>
        <button className={`chip ${mode === 'signup' ? 'chip-active' : ''}`} onClick={() => setMode('signup')}>
          Create account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="settings-form">
        {mode === 'signup' && (
          <label className="settings-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Bruce Wayne" />
          </label>
        )}
        <label className="settings-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
            autoFocus
          />
        </label>
        <label className="settings-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            minLength={mode === 'signup' ? 8 : 1}
            required
          />
        </label>

        {showServer ? (
          <label className="settings-field">
            <span>Server URL</span>
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://127.0.0.1:8000" />
          </label>
        ) : (
          <button type="button" className="link-button" onClick={() => setShowServer(true)}>
            Server: {apiBase}
          </button>
        )}

        {error && <p className="hint-text hint-error">{error}</p>}
        <button className="action-button" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="hint-text privacy-note">
        Alfred takes a screenshot only when a question actually needs one. It is sent to the AI to find the next
        step and never saved. Your password is hashed and your session token is encrypted with your OS keychain.
      </p>
    </div>
  );
}
