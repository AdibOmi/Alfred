# Alfred

A small floating assistant that lives in the corner of your screen. Click the icon and you get one panel
with two things in it:

- **Ask** — a question about whatever you're looking at. "How do I delete a blank page in Word?" Alfred
  takes a single screenshot, sends it to Claude, and answers with numbered steps that name the actual menus
  and buttons on your screen.
- **Tasks** — to-dos and reminders. Add them in the panel, or just say so in the chat: *"remind me to submit
  the form at 4pm"*. When a reminder comes due you get a native OS notification.

Both live behind the same text box, because Claude decides what the question needs.

## How a question is answered

Every message runs a short tool-use loop in the Electron main process. Claude is given five tools —
`look_at_screen`, `create_task`, `update_task`, `complete_task`, `delete_task` — and picks.

That design decides the privacy model for free. **No screenshot is taken up front.** "Add buy milk to my
list" never touches the screen at all, because Claude has no reason to call `look_at_screen`. When it does
call it, the PNG is captured in memory, attached to that one request, and discarded when the loop returns.

The current task list is injected into the system prompt on every turn rather than hidden behind a
`list_tasks` tool. It's small, it's what most task questions are about, and having the ids up front means
*"mark the dentist one done"* resolves in a single round trip instead of two.

## What Alfred does not do

- **No continuous or background screen capture.** A screenshot happens only inside `look_at_screen`, only
  during a request you triggered, never on a timer and never while idle.
- **No screenshots on disk, ever.** The image exists for one request/response round trip and is never
  written to a file, a database, or back to the renderer.
- **No chat history persisted.** The conversation is in-memory React state; the last few turns travel with
  each request so follow-ups work, and closing the app clears everything.
- **No analytics or telemetry.** Nothing leaves your machine except the questions, and the screenshots, you
  explicitly send to Claude.
- **No database.** Tasks are a flat JSON file in Electron's per-user data directory. Your API key is
  encrypted through the OS keychain.

## Stack

- **Shell:** Electron — one small frameless always-on-top window, plus a tray icon
- **UI:** React + TypeScript
- **Brain:** Claude API (`@anthropic-ai/sdk`), `claude-opus-5` running a tool-use loop at `effort: "low"`
  so the panel stays responsive
- **Storage:** `electron-store` for tasks and preferences, Electron `safeStorage` (Keychain / DPAPI) for
  the API key

There's no backend server and no IPC-over-HTTP. The renderer talks to the main process over
`contextBridge`/IPC, and the main process makes the Claude call itself, so the API key never reaches the
renderer.

## Setup

```bash
npm install
npm start
```

On first launch, click the floating icon and paste in an Anthropic API key (get one at
console.anthropic.com). It's encrypted via your OS credential store, so you won't re-enter it on relaunch.

`npm start` compiles the main process before launching Electron. That step is not optional: the preload
script runs in its own sandboxed context, outside the TypeScript loader that handles `main.ts` in dev, so
it has to exist as real JavaScript in `dist/` before the window opens. A missing preload is dropped by
Electron without a word and shows up as a blank panel, so `createFloatingWindow` now throws a named error
instead. Editing `preload.ts` means restarting `npm start`; the React UI still hot-reloads normally.

> If Electron exits immediately or behaves like plain Node, check that `ELECTRON_RUN_AS_NODE` isn't set in
> your shell — it forces the Electron binary into Node mode and the app will never start.

## Using it

1. Click the floating icon, or press **Ctrl/Cmd + Shift + A** from anywhere.
2. **Ask** for screen help, or hand Alfred a task in the same box.
3. **Tasks** lists everything open, with overdue reminders flagged in red. Tick to complete, or use the
   clock button to set or change a reminder time.
4. Press Escape, or click away, to collapse back down to the icon.
5. Drag the icon anywhere; its position is remembered. A dot appears on it when a reminder is overdue.

Reminders fire as native notifications. Clicking one opens Alfred on the Tasks view. A reminder that came
due while Alfred was closed still fires the next time it runs, rather than being silently skipped.

## Settings

The gear icon inside the panel has API key entry, a launch-at-login toggle, and a reset for the icon
position.

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
  electron/   main process
    agent.ts        the Claude tool-use loop — the core of the app
    capture.ts      one-shot in-memory screenshot + macOS permission check
    taskStore.ts    task persistence
    reminders.ts    due-reminder sweep and OS notifications
    window.ts       floating window, tray, expand/collapse geometry
    store.ts        encrypted API key and preferences
  renderer/   the icon, chat panel, tasks panel, and settings UI (React)
  shared/     pure logic used by both sides — task rules and date formatting,
              kept Electron-free so it can be unit-tested directly
```

The unit tests cover the parts worth protecting: window geometry, task state transitions, which reminders
are owed at a given moment, and the local-time formatting that a naive `toISOString()` would get wrong.

## Permissions

On macOS, Alfred needs Screen Recording permission (System Settings → Privacy & Security → Screen
Recording). If it isn't granted, Alfred says so and offers a shortcut to the right settings pane instead of
failing silently. Tasks and reminders work fine without it.

## Known follow-ups

- No code signing on the packaged installer — Windows SmartScreen and macOS Gatekeeper will warn on first
  run for anyone other than the machine that built it.
- No auto-update wiring (`electron-updater` isn't set up); updates are manual.
- Reminders are swept every 30 seconds rather than scheduled per task. That's deliberate — a long
  `setTimeout` doesn't survive system sleep — but it does mean a reminder can fire up to 30 seconds late.
- Recurring reminders ("every weekday at 9") aren't supported; each reminder fires once.
