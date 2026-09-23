import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

/**
 * Shown when window.alfred is missing.
 *
 * Two very different situations leave the bridge undefined, and they need
 * opposite advice. Opening the Vite dev server straight in a web browser has
 * no preload by definition — nothing is broken, it is just the wrong window,
 * and telling someone to rebuild sends them chasing a bug that isn't there.
 * Inside Electron the same symptom does mean a genuinely missing preload.
 * Electron stamps its own name into the user agent, so use that to tell them
 * apart.
 */
function BridgeMissing() {
  const insideElectron = navigator.userAgent.includes('Electron');

  if (!insideElectron) {
    return (
      <div className="panel-shell">
        <div className="panel-header-row">
          <h2>Open Alfred in its own window</h2>
        </div>
        <p className="hint-text">
          This is Alfred&apos;s dev server viewed in a web browser. Alfred is a desktop app, so the panel
          only works inside the Electron window that <code>npm start</code> opens.
        </p>
        <p className="hint-text">
          Look for the floating icon at the edge of your screen, or press <code>Ctrl+Shift+A</code>{' '}
          (<code>Cmd+Shift+A</code> on macOS).
        </p>
      </div>
    );
  }

  return (
    <div className="panel-shell">
      <div className="panel-header-row">
        <h2>Alfred can&apos;t start</h2>
      </div>
      <p className="hint-text">
        The preload bridge didn&apos;t load, so the interface has no way to reach the main process.
      </p>
      <p className="hint-text">
        Run <code>npm run build:main</code> to compile it, then start Alfred again.
      </p>
    </div>
  );
}

// Every panel in the app talks to the main process through window.alfred. If the
// preload script failed to load, Electron says nothing about it and the first
// bridge call throws during render, which used to surface as a silent blank
// window. Check once, up front, and say what actually went wrong instead.
if (typeof window.alfred === 'undefined') {
  root.render(<BridgeMissing />);
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
