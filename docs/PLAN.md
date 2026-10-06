# Alfred: one-page plan

**Problem.** Students and new office workers get stuck in unfamiliar software (Excel, Word, PowerPoint, university portals). Tutorials say "go to Insert > Chart", but people can't find *Insert* on their own screen, so they give up or wait for help.

**User.** A student who opens Excel for an assignment and doesn't know where anything is.

**Starting point.** An earlier version of Alfred (this repo, September 2026): a floating Electron + React panel that sent a screenshot to Claude and answered in text, plus local to-dos and reminders. It had no backend, needed a paid API key, and described where to click instead of showing it.

**Solution.** Keep the floating panel, tasks and reminders. Add a backend, move the AI there on a free model, and make Alfred *point*: one step at a time, on a fresh screenshot each time, with a ghost cursor on the exact element.

**Concepts used (target ≥5):** API endpoints, database, authentication, background/cron jobs, PDF + email reporting, caching, LLM integration (all 7).

**Free stack.** FastAPI + SQLite + APScheduler + fpdf2 (Python); Electron + React + TypeScript (desktop); Google Gemini free tier; Gmail SMTP (optional).

## Scope guard

In scope: one display at a time, Windows first (macOS/Linux work without moving the real pointer), single next-step grounding, tasks and reminders, weekly report.

Out of scope (later): voice input, clicking *for* the user, multi-monitor targets, offline local model, classroom dashboards, packaged installer.

## Milestones

| # | Milestone | Done when |
| --- | --- | --- |
| 1 | Plan | This page |
| 2 | Backend core | Auth, database, `/sessions` and `/tasks` working with a mock LLM; tests green |
| 3 | AI on the server | Gemini tool loop for chat + tasks; vision returns one step with a bounding box; repeat questions hit the cache |
| 4 | Desktop | Sign-in, server-backed tasks, overlay pointer, next-step loop, history panel |
| 5 | Reports, jobs, submission | Weekly PDF + email, missed-reminder emails, README, write-up |

## Reused from the course

- Weeks 2–3: FastAPI CRUD + SQLite patterns → tasks, sessions and steps tables
- Week 4: bearer-token auth dependency + `{"error": ...}` handlers → `auth.py` and the error handlers
- Week 5: caching fetched results to avoid repeat work → the LLM response cache
