# Alfred

A personal desktop assistant in the Batcomputer mold: reminders with a color-coded
deadline timeline, local file search, a Claude-powered chat, and a progress
dashboard pulling from GitHub, LeetCode, and a manual gym log.

## Stack

- **Shell:** Electron
- **UI:** React + TypeScript, Framer Motion, Recharts
- **Backend:** Express + better-sqlite3, running inside the Electron main process
  and exposed on `http://127.0.0.1:4789` — a real local HTTP API, not just IPC, so
  a future phone client can talk to the same interface.
- **Brain:** Claude API (`@anthropic-ai/sdk`) for chat and natural-language
  reminder parsing, with a deterministic fallback parser when no API key is set.

## Setup

```bash
npm install
cp .env.example .env   # fill in whichever keys you have — all optional
npm start
```

`npm start` runs the Vite dev server and Electron concurrently. Every panel
degrades gracefully with no `.env` at all: Chat explains it needs a key, and the
GitHub/LeetCode cards show a one-line "not configured" hint instead of failing.

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Dev mode: Vite dev server + Electron, hot-reloading the renderer |
| `npm run typecheck` | `tsc --noEmit` across the whole project |
| `npm run build` | Compiles main/backend, builds the renderer, packages via electron-builder |
| `npm run lint` | ESLint over `.ts`/`.tsx` |

## Project layout

```
src/
  electron/   main process: window, tray, notification scheduler, preload bridge
  backend/    Express API: tasks, search, chat, github, leetcode, gym, settings
  renderer/   React UI (panels: reminders, search, chat, progress)
  shared/     constants/helpers used by both backend and renderer (e.g. the
              backend port, local-date formatting)
```

The renderer talks to the backend over plain `fetch()` against
`http://127.0.0.1:4789`, not Electron IPC — that's deliberate, so the same
backend can later serve a React Native client without duplicating logic.

## Configuration reference

All of these live in `.env` (project root for `npm run dev`, or
`<userData>/.env` for a packaged build — see `app.getPath('userData')`).

- `ANTHROPIC_API_KEY` — chat + natural-language reminder capture
- `GITHUB_USERNAME` — required for the GitHub card; unauthenticated REST is used
  if that's all you set (rate-limited, last ~7 days of public events)
- `GITHUB_TOKEN` — optional; switches the GitHub card to GraphQL for a proper
  30-day contribution calendar
- `LEETCODE_USERNAME` — required for the LeetCode card (uses LeetCode's public
  GraphQL endpoint, no auth needed)

## File search

On Windows, Alfred uses the [Everything](https://www.voidtools.com/) CLI
(`es.exe`) if it's on your `PATH` for instant whole-system search, and falls
back to a scoped PowerShell search of Desktop/Documents/Downloads/Pictures
otherwise. macOS uses `mdfind`; Linux uses `find` over the same folder set.

## Known follow-ups

- The renderer bundle is a single ~700KB chunk (mostly Recharts + Framer
  Motion). Not a problem for a local Electron app, but worth code-splitting if
  the UI grows meaningfully.
- Voice commands and the React Native phone client are intentionally out of
  scope for this pass — see the original project brief.
