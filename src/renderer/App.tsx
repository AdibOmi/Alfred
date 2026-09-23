import { useCallback, useEffect, useState } from 'react';
import { ChatPanel } from './ui/ChatPanel';
import { TasksPanel } from './ui/TasksPanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { openTaskCount, overdueCount, type Task } from '../shared/tasks';

type View = 'chat' | 'tasks' | 'settings';

export function App() {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<View>('chat');
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    window.alfred.getState().then((state) => {
      setHasApiKey(state.hasApiKey);
      setAutoLaunch(state.autoLaunch);
    });
    window.alfred.listTasks().then(setTasks);

    // The main process owns the task list, so every mutation — whether it came
    // from this panel, from Claude during a chat turn, or from a reminder
    // firing — comes back through this one channel.
    const unsubscribeTasks = window.alfred.onTasksChanged(setTasks);
    const unsubscribeExpanded = window.alfred.onExpandedChanged(setExpanded);
    const unsubscribeView = window.alfred.onShowView((requested) => setView(requested));

    return () => {
      unsubscribeTasks();
      unsubscribeExpanded();
      unsubscribeView();
    };
  }, []);

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
    if (!hasApiKey) setView('settings');
  };

  const pendingOverdue = overdueCount(tasks, new Date());
  const pendingOpen = openTaskCount(tasks);

  return (
    <div className="app-shell">
      {!expanded && (
        <div className="floating-icon" onClick={open} role="button" aria-label="Open Alfred" tabIndex={0}>
          <span>◆</span>
          {pendingOverdue > 0 && <span className="icon-badge" aria-label={`${pendingOverdue} overdue`} />}
        </div>
      )}

      {expanded && (
        <div className="panel-shell">
          {hasApiKey === null && <p className="hint-text">Loading…</p>}

          {hasApiKey !== null && view === 'settings' && (
            <SettingsPanel
              firstRun={!hasApiKey}
              autoLaunch={autoLaunch}
              onSaved={(saved) => {
                setHasApiKey(saved);
                setView('chat');
              }}
              onBack={hasApiKey ? () => setView('chat') : undefined}
            />
          )}

          {hasApiKey !== null && view !== 'settings' && (
            <>
              <nav className="view-tabs">
                <button
                  className={`tab ${view === 'chat' ? 'tab-active' : ''}`}
                  onClick={() => setView('chat')}
                >
                  Ask
                </button>
                <button
                  className={`tab ${view === 'tasks' ? 'tab-active' : ''}`}
                  onClick={() => setView('tasks')}
                >
                  Tasks
                  {pendingOpen > 0 && (
                    <span className={`tab-count ${pendingOverdue > 0 ? 'tab-count-alert' : ''}`}>{pendingOpen}</span>
                  )}
                </button>
              </nav>

              {view === 'chat' && <ChatPanel onOpenSettings={() => setView('settings')} onClose={collapse} />}
              {view === 'tasks' && (
                <TasksPanel tasks={tasks} onOpenSettings={() => setView('settings')} onClose={collapse} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
