# Alfred

A tiny floating on-screen assistant. Alfred lives as one small icon in the corner of your screen. Click it,
ask a question about whatever you're looking at — "how do I delete a blank page in Word?" — and Alfred takes
a single screenshot, sends it with your question to a vision-capable Claude model, and answers with clear,
numbered steps.

That's the whole product.

## What Alfred does NOT do

This is a deliberate privacy-by-design pivot away from an earlier, much bigger version of this app that did
reminders, filesystem search, and progress dashboards backed by a local SQLite database. None of that
survives, on purpose:

- **No continuous or background screen capture.** A screenshot is taken exactly once, synchronously, only
  when you press submit on a question — never on a timer, never while idle.
- **No screenshots on disk, ever.** The captured image lives in memory for the single request/response
  round trip to Claude and is discarded the moment that call returns. It is never written to a file or a
  database.
- **No chat history persisted.** The conversation in the panel is in-memory React state — closing or
  restarting the app clears it. There is nothing to persist by design.
- **No analytics, telemetry, or crash reporting that phones home.** Nothing about your usage leaves your
  machine except the one screenshot + question you explicitly send to Claude for an answer.
- **No SQLite, no local database at all.** The only persistent state is your API key (encrypted via the OS
  keychain) and two small preferences (auto-launch, icon position), stored in a flat local config file.

## Stack

- **Shell:** Electron — a single small, frameless, always-on-top floating window plus a tray icon
- **UI:** React + TypeScript
- **Brain:** Claude API (`@anthropic-ai/sdk`), vision-capable model, one request per question
- **Config:** `electron-store` + Electron's `safeStorage` (OS keychain/DPAPI) for the API key — never
  plaintext on disk

There is no backend server and no IPC-over-HTTP — the renderer talks to the main process directly over
`contextBridge`/IPC, and the main process makes the Claude API call itself.

## Setup

```bash
npm install
npm start
```

On first launch, click the floating icon and paste in an Anthropic API key (get one at
console.anthropic.com) — it's encrypted and stored locally via your OS's secure credential store, so you
won't need to re-enter it on relaunch.

## Using it

1. Click the floating icon.
2. Type your question about whatever's on screen.
3. Alfred captures the screen once, asks Claude, and shows the answer.
4. Press Escape, or click away, to collapse the panel back down to just the icon.
5. Drag the icon anywhere on screen; its position is remembered.

## Settings

Click the gear icon inside the panel for:

- API key entry/update (stored via `safeStorage`, never in plaintext)
- Auto-launch on login toggle
- Reset icon position (back to the bottom-right corner)

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Dev mode: Vite dev server + Electron, hot-reloading the UI |
| `npm run typecheck` | `tsc --noEmit` across the whole project |
| `npm run test` | Runs the Vitest suite |
| `npm run build` | Compiles the main process, builds the UI, packages via electron-builder |
| `npm run lint` | ESLint over `.ts`/`.tsx` |

## Project layout

```
src/
  electron/   main process: floating window + tray, IPC handlers, screenshot capture,
              the Claude vision call, and encrypted config storage
  renderer/   the icon + chat panel + settings UI (React)
  shared/     the one constant (icon size) shared between main and renderer
```

## Permissions

On macOS, Alfred needs Screen Recording permission to capture the screen (System Settings → Privacy &
Security → Screen Recording). If it isn't granted, Alfred detects this and shows you exactly where to enable
it instead of failing silently.

## Known follow-ups

- No code signing on the packaged installer — Windows SmartScreen / macOS Gatekeeper will warn on first run
  for anyone besides the machine that built it.
- No auto-update wiring (`electron-updater` isn't set up) — updates are manual for now.
