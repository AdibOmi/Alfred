import { useEffect, useState } from 'react';
import { ChatPanel } from './ui/ChatPanel';
import { SettingsPanel } from './ui/SettingsPanel';

type View = 'chat' | 'settings';

export function App() {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<View>('chat');
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [autoLaunch, setAutoLaunch] = useState(false);

  useEffect(() => {
    window.alfred.getState().then((state) => {
      setHasApiKey(state.hasApiKey);
      setAutoLaunch(state.autoLaunch);
    });
    return window.alfred.onExpandedChanged(setExpanded);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') collapse();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded]);

  const open = async () => {
    await window.alfred.setExpanded(true);
    setExpanded(true);
    setView(hasApiKey ? 'chat' : 'settings');
  };

  const collapse = async () => {
    setExpanded(false);
    await window.alfred.setExpanded(false);
  };

  return (
    <div className="app-shell">
      {!expanded && (
        <div className="floating-icon" onClick={open} role="button" aria-label="Open Alfred" tabIndex={0}>
          <span>◆</span>
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
              onBack={() => setView('chat')}
            />
          )}
          {hasApiKey !== null && view === 'chat' && (
            <ChatPanel onOpenSettings={() => setView('settings')} onClose={collapse} />
          )}
        </div>
      )}
    </div>
  );
}
