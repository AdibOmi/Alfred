import { useEffect, useState } from 'react';
import { api, type Settings, type TaskKind } from '../api';
import { QuickAddPopover } from './QuickAddPopover';

interface TopBarProps {
  chatOpen: boolean;
  onToggleChat: () => void;
  onCapture: (text: string, kind?: TaskKind) => Promise<void>;
}

export function TopBar({ chatOpen, onToggleChat, onCapture }: TopBarProps) {
  const [now, setNow] = useState(new Date());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  const configuredCount = settings
    ? [settings.anthropicConfigured, settings.githubConfigured, settings.leetcodeConfigured].filter(Boolean).length
    : 0;

  return (
    <header className="top-bar">
      <span className="clock">
        {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        {' · '}
        {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      <div className="top-bar-right">
        <div className="status-chip" title={settings ? `${configuredCount}/3 integrations configured` : undefined}>
          {settings ? `${configuredCount}/3 linked` : 'Ready'}
        </div>
        <button className="action-button" onClick={() => setQuickAddOpen((v) => !v)}>
          + Quick Add
        </button>
        <button
          className={`ghost-button chat-toggle-btn ${chatOpen ? 'active' : ''}`}
          onClick={onToggleChat}
        >
          Ask Alfred
        </button>
        {quickAddOpen && (
          <QuickAddPopover onCapture={onCapture} onClose={() => setQuickAddOpen(false)} />
        )}
      </div>
    </header>
  );
}
