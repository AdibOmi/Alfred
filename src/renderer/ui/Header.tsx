import { useEffect, useState } from 'react';
import { api, type Settings } from '../api';

export function Header() {
  const [now, setNow] = useState(new Date());
  const [settings, setSettings] = useState<Settings | null>(null);

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
      <div>
        <p className="eyebrow">ALFRED</p>
        <h1>Operational Console</h1>
      </div>
      <div className="header-right">
        <span className="clock">
          {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <div className="status-chip" title={settings ? `${configuredCount}/3 integrations configured` : undefined}>
          {settings ? `${configuredCount}/3 linked` : 'Ready'}
        </div>
      </div>
    </header>
  );
}
