import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChatPanel, type ChatMessage } from './ui/ChatPanel';
import { TasksPanel } from './ui/TasksPanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { HistoryPanel } from './ui/HistoryPanel';
import { AuthPanel } from './ui/AuthPanel';
import { openTaskCount, overdueCount, type Task } from '../shared/tasks';
import { EMBLEM_PATHS, EMBLEM_VIEWBOX } from '../shared/emblem';
import type { AppState, AssistResponse } from '../electron/preload';

type View = 'chat' | 'tasks' | 'history' | 'settings';

// The icon is both a button and a drag handle. A press that moves less than this
// many pixels is a click; anything more drags the window. (An OS drag region can't
// be used: on Windows it swallows the click.)
const DRAG_THRESHOLD = 4;
let press: { x: number; y: number; dragging: boolean } | null = null;

function startIconPress(event: ReactPointerEvent<HTMLDivElement>) {
  if (event.button !== 0) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  press = { x: event.screenX, y: event.screenY, dragging: false };
}

function moveIconPress(event: ReactPointerEvent<HTMLDivElement>) {
  if (!press) return;
  const dx = event.screenX - press.x;
  const dy = event.screenY - press.y;
  if (!press.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  if (!press.dragging) {
    press.dragging = true;
    window.alfred.iconDragStart();
  }
  window.alfred.iconDragMove(dx, dy);
}

function endIconPress(event: ReactPointerEvent<HTMLDivElement>, onClick: (() => void) | null) {
  if (!press) return;
  const wasDrag = press.dragging;
  press = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  if (wasDrag) window.alfred.iconDragEnd();
  else onClick?.();
}

export function App() {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<View>('chat');
  const [state, setState] = useState<AppState | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  // Lifted out of ChatPanel so the conversation and the step in progress survive
  // the panel collapsing while the user clicks around in their own app.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [guide, setGuide] = useState<AssistResponse | null>(null);

  const reloadState = useCallback(async () => {
    const next = await window.alfred.getState();
    setState(next);
    if (!next.guide.active) setGuide(null);
    else if (next.guide.last) setGuide(next.guide.last);
    return next;
  }, []);

  useEffect(() => {
    reloadState();
    window.alfred.listTasks().then(setTasks);

    // The main process owns the task list, so every mutation — whether it came
    // from this panel, from the chat, or from a reminder firing — comes back
    // through this one channel.
    const unsubscribeTasks = window.alfred.onTasksChanged(setTasks);
    const unsubscribeExpanded = window.alfred.onExpandedChanged(setExpanded);
    const unsubscribeView = window.alfred.onShowView((requested) => setView(requested));

    return () => {
      unsubscribeTasks();
      unsubscribeExpanded();
      unsubscribeView();
    };
  }, [reloadState]);

  useEffect(() => {
    if (expanded) {
      reloadState();
      window.alfred.refreshTasks();
    }
  }, [expanded, reloadState]);

  const collapse = useCallback(async () => {
    setExpanded(false);
    await window.alfred.setExpanded(false);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') collapse();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded, collapse]);

  const open = async () => {
    await window.alfred.setExpanded(true);
    setExpanded(true);
  };

  const signedOut = useCallback(() => {
    setMessages([]);
    setGuide(null);
    reloadState();
  }, [reloadState]);

  const pendingOverdue = overdueCount(tasks, new Date());
  const pendingOpen = openTaskCount(tasks);
  const signedIn = Boolean(state?.user);

  return (
    <div className="app-shell">
      {!expanded && (
        <div
          className="floating-icon"
          onPointerDown={startIconPress}
          onPointerMove={moveIconPress}
          onPointerUp={(event) => endIconPress(event, open)}
          onPointerCancel={(event) => endIconPress(event, null)}
          onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && open()}
          role="button"
          aria-label="Open Alfred"
          tabIndex={0}
        >
          <svg className="emblem" viewBox={`0 0 ${EMBLEM_VIEWBOX} ${EMBLEM_VIEWBOX}`} aria-hidden="true">
            {EMBLEM_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
          {(pendingOverdue > 0 || guide) && (
            <span className={`icon-badge ${guide ? 'icon-badge-guide' : ''}`} aria-label={guide ? 'Step in progress' : `${pendingOverdue} overdue`} />
          )}
        </div>
      )}

      {expanded && (
        <div className="panel-shell">
          {state === null && <p className="hint-text">Loading…</p>}

          {state !== null && view === 'settings' && (
            <SettingsPanel
              state={state}
              onChanged={(next) => {
                setState(next);
                if (!next.user) signedOut();
              }}
              onBack={() => setView('chat')}
            />
          )}

          {state !== null && view !== 'settings' && !signedIn && (
            <AuthPanel
              apiBase={state.apiBase}
              onSignedIn={(next) => {
                setState(next);
                setView('chat');
              }}
              onClose={collapse}
            />
          )}

          {state !== null && view !== 'settings' && signedIn && (
            <>
              <nav className="view-tabs">
                <button className={`tab ${view === 'chat' ? 'tab-active' : ''}`} onClick={() => setView('chat')}>
                  Ask
                </button>
                <button className={`tab ${view === 'tasks' ? 'tab-active' : ''}`} onClick={() => setView('tasks')}>
                  Tasks
                  {pendingOpen > 0 && (
                    <span className={`tab-count ${pendingOverdue > 0 ? 'tab-count-alert' : ''}`}>{pendingOpen}</span>
                  )}
                </button>
                <button className={`tab ${view === 'history' ? 'tab-active' : ''}`} onClick={() => setView('history')}>
                  History
                </button>
              </nav>

              {view === 'chat' && (
                <ChatPanel
                  messages={messages}
                  setMessages={setMessages}
                  guide={guide}
                  setGuide={setGuide}
                  onOpenSettings={() => setView('settings')}
                  onClose={collapse}
                  onSignedOut={signedOut}
                />
              )}
              {view === 'tasks' && (
                <TasksPanel tasks={tasks} onOpenSettings={() => setView('settings')} onClose={collapse} />
              )}
              {view === 'history' && (
                <HistoryPanel onOpenSettings={() => setView('settings')} onClose={collapse} onSignedOut={signedOut} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
