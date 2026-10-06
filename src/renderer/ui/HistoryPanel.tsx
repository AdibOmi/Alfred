import { useEffect, useState } from 'react';
import type { SessionDetail, SessionSummary, Stats } from '../../electron/preload';
import { BridgeError, call } from '../bridge';

interface HistoryPanelProps {
  onOpenSettings: () => void;
  onClose: () => void;
  onSignedOut: () => void;
}

function SessionRow({ session }: { session: SessionSummary }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [open, setOpen] = useState(false);

  const toggle = async () => {
    if (!open && !detail) {
      try {
        setDetail(await call(window.alfred.session(session.id)));
      } catch {
        // the list still shows; the steps just don't expand
      }
    }
    setOpen((value) => !value);
  };

  return (
    <li className="session-row" onClick={toggle}>
      <div className="session-goal">{session.goal}</div>
      <div className="session-sub">
        <span>
          {session.app_name ?? 'Unknown app'} · {new Date(session.created_at).toLocaleDateString()} · {session.step_count}{' '}
          {session.step_count === 1 ? 'step' : 'steps'}
        </span>
        <span className={`status-badge status-${session.status}`}>{session.status}</span>
      </div>
      {open && detail && (
        <ol className="session-steps">
          {detail.steps.map((step) => (
            <li key={step.position}>{step.instruction}</li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function HistoryPanel({ onOpenSettings, onClose, onSignedOut }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const report = (error: unknown) => {
    if (error instanceof BridgeError && error.code === 'signed-out') onSignedOut();
    else setNote((error as Error).message);
  };

  useEffect(() => {
    call(window.alfred.history())
      .then((data) => {
        setSessions(data.sessions);
        setStats(data.stats);
      })
      .catch(report);
  }, []);

  const openReport = async () => {
    setBusy(true);
    setNote('Preparing your PDF…');
    try {
      await call(window.alfred.openReport());
      setNote('Opened in your PDF viewer.');
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };

  const emailReport = async () => {
    setBusy(true);
    try {
      setNote((await call(window.alfred.emailReport())).message);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tasks-panel">
      <div className="panel-header-row">
        <h2>History &amp; reports</h2>
        <div className="panel-header-actions">
          <button className="icon-button" onClick={onOpenSettings} aria-label="Settings">
            ⚙
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      {stats && (
        <div className="stat-row">
          <div className="stat">
            <b>{stats.sessions}</b>
            <span>times asked</span>
          </div>
          <div className="stat">
            <b>{stats.solved}</b>
            <span>solved</span>
          </div>
          <div className="stat">
            <b>{stats.steps}</b>
            <span>steps guided</span>
          </div>
        </div>
      )}

      <div className="task-add-row">
        <button className="action-button grow" onClick={openReport} disabled={busy}>
          This week&apos;s PDF
        </button>
        <button className="ghost-button grow" onClick={emailReport} disabled={busy}>
          Email it to me
        </button>
      </div>
      {note && <p className="hint-text">{note}</p>}

      <div className="tasks-list-window">
        {sessions === null && !note && <p className="hint-text">Loading…</p>}
        {sessions?.length === 0 && (
          <p className="hint-text">Nothing yet. Every task Alfred walks you through shows up here, steps included.</p>
        )}
        <ul className="task-list">
          {sessions?.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      </div>
    </div>
  );
}
