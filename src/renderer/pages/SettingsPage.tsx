import { useEffect, useState } from 'react';
import { api, type Settings } from '../api';

function StatusRow({ label, configured, detail }: { label: string; configured: boolean; detail?: string }) {
  return (
    <div className="tracker-manager-row">
      <span>{label}</span>
      <span className={`tracker-type-badge ${configured ? '' : 'hint-error'}`}>
        {configured ? detail ?? 'Connected' : 'Not configured'}
      </span>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  return (
    <>
      <div className="page-header">
        <p className="eyebrow">Settings</p>
        <h2>Configuration</h2>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Integrations</p>
            <h3>Connected services</h3>
          </div>
        </div>
        {!settings ? (
          <p className="hint-text">Loading…</p>
        ) : (
          <div className="tracker-manager-list">
            <StatusRow label="Claude (chat)" configured={settings.anthropicConfigured} />
            <StatusRow
              label="GitHub"
              configured={settings.githubConfigured}
              detail={settings.githubUsername ?? undefined}
            />
            <StatusRow
              label="LeetCode"
              configured={settings.leetcodeConfigured}
              detail={settings.leetcodeUsername ?? undefined}
            />
          </div>
        )}
        <p className="hint-text" style={{ marginTop: 16 }}>
          Integrations are configured via environment variables (<code>.env</code>) — set{' '}
          <code>ANTHROPIC_API_KEY</code>, <code>GITHUB_USERNAME</code> / <code>GITHUB_TOKEN</code>, or{' '}
          <code>LEETCODE_USERNAME</code> and restart Alfred to connect them.
        </p>
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">System</p>
            <h3>App behavior</h3>
          </div>
        </div>
        <div className="tracker-manager-list">
          <div className="tracker-manager-row">
            <span>Launch on system login</span>
            <span className="tracker-type-badge">Enabled for packaged builds</span>
          </div>
          <div className="tracker-manager-row">
            <span>Data storage</span>
            <span className="tracker-type-badge">Local SQLite only</span>
          </div>
        </div>
      </section>
    </>
  );
}
