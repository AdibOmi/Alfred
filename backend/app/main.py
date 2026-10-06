"""Alfred API: the backend behind the desktop butler."""
from __future__ import annotations

import logging
import sqlite3
from contextlib import asynccontextmanager
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import agent, cache, config, jobs, llm, reports, tasks
from .auth import CurrentUser, create_access_token, hash_password, verify_password
from .db import get_db, init_db, now_iso
from .imaging import InvalidScreenshot, Screenshot, decode_screenshot
from .schemas import (
    AssistResponse,
    ChatRequest,
    ChatResponse,
    TaskCreate,
    TaskOut,
    TaskUpdate,
    ErrorResponse,
    LoginRequest,
    NextStepRequest,
    SessionDetail,
    SessionSummary,
    SignupRequest,
    StartSessionRequest,
    StatusUpdate,
    StepOut,
    TokenResponse,
    UserOut,
    UserUpdate,
)

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if config.SCHEDULER_ENABLED:
        jobs.start()
    logger.info("Alfred API ready (LLM provider: %s, email: %s)", config.LLM_PROVIDER, "on" if config.EMAIL_ENABLED else "off")
    yield
    jobs.stop()


app = FastAPI(
    title="Alfred API",
    description="Backend for Alfred, a desktop butler that looks at your screen and walks you through software step by step.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ERRORS: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse},
    401: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
}


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail}, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = sorted({str(err["loc"][-1]) for err in exc.errors() if err.get("loc")})
    message = f"Invalid or missing fields: {', '.join(fields)}" if fields else "Invalid request body"
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"error": message})


def _user_out(row: sqlite3.Row | dict) -> UserOut:
    row = dict(row)
    return UserOut(
        id=row["id"], email=row["email"], name=row["name"],
        weekly_report=bool(row["weekly_report"]), created_at=row["created_at"],
    )


# ---------------------------------------------------------------- public

@app.get("/health", tags=["Public"])
def health() -> dict:
    provider = llm.get_provider()
    return {"status": "ok", "llm_provider": provider.name, "llm_model": provider.model, "email_enabled": config.EMAIL_ENABLED}


# ---------------------------------------------------------------- auth

@app.post("/auth/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, tags=["Auth"], responses=ERRORS)
def signup(body: SignupRequest) -> TokenResponse:
    try:
        with get_db() as conn:
            cursor = conn.execute(
                "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (body.email.lower(), body.name.strip(), hash_password(body.password), now_iso()),
            )
            row = conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    except sqlite3.IntegrityError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An account with that email already exists") from error
    return TokenResponse(access_token=create_access_token(row["id"]), user=_user_out(row))


@app.post("/auth/login", response_model=TokenResponse, tags=["Auth"], responses=ERRORS)
def login(body: LoginRequest) -> TokenResponse:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (body.email.lower(),)).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return TokenResponse(access_token=create_access_token(row["id"]), user=_user_out(row))


@app.get("/auth/me", response_model=UserOut, tags=["Auth"], responses=ERRORS)
def me(user: CurrentUser) -> UserOut:
    return _user_out(user)


@app.patch("/auth/me", response_model=UserOut, tags=["Auth"], responses=ERRORS)
def update_me(body: UserUpdate, user: CurrentUser) -> UserOut:
    with get_db() as conn:
        if body.name is not None:
            conn.execute("UPDATE users SET name = ? WHERE id = ?", (body.name.strip(), user["id"]))
        if body.weekly_report is not None:
            conn.execute("UPDATE users SET weekly_report = ? WHERE id = ?", (int(body.weekly_report), user["id"]))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return _user_out(row)


# ---------------------------------------------------------------- assistance

def _decode(screenshot: str) -> Screenshot:
    try:
        return decode_screenshot(screenshot)
    except InvalidScreenshot as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error


def _ask_alfred(goal: str, shot: Screenshot, completed: list[str], message: str | None) -> tuple[dict, bool]:
    """Cache-first call to the vision model. Returns (answer, from_cache)."""
    provider = llm.get_provider()
    key = cache.make_key(provider.name, provider.model, shot.phash, goal.strip().lower(), completed, (message or "").strip().lower())
    cached = cache.get(key)
    if cached is not None:
        return cached, True
    try:
        answer = provider.next_step(llm.StepRequest(goal=goal, screenshot_jpeg=shot.jpeg, completed_steps=completed, user_message=message))
    except llm.LLMError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
    cache.put(key, answer)
    return answer, False


def _record_answer(conn: sqlite3.Connection, session_id: int, answer: dict, from_cache: bool) -> StepOut:
    conn.execute(
        "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'alfred', ?, ?)",
        (session_id, answer["reply"] or answer["step"]["instruction"], now_iso()),
    )
    position = conn.execute("SELECT COUNT(*) FROM steps WHERE session_id = ?", (session_id,)).fetchone()[0] + 1
    step = answer["step"]
    box = step["box_2d"] or [None] * 4
    step_id = None
    if not answer["done"]:
        step_id = conn.execute(
            """
            INSERT INTO steps (session_id, position, instruction, target_label, action,
                               box_ymin, box_xmin, box_ymax, box_xmax, from_cache, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (session_id, position, step["instruction"], step["target_label"], step["action"], *box, int(from_cache), now_iso()),
        ).lastrowid
    new_status = "solved" if answer["done"] else "active"
    conn.execute(
        "UPDATE help_sessions SET status = ?, app_name = COALESCE(?, app_name), updated_at = ? WHERE id = ?",
        (new_status, answer["app"], now_iso(), session_id),
    )
    return StepOut(id=step_id, position=position, **step)


def _response(session_id: int, answer: dict, step: StepOut, from_cache: bool) -> AssistResponse:
    return AssistResponse(
        session_id=session_id,
        status="solved" if answer["done"] else "active",
        app=answer["app"],
        reply=answer["reply"],
        step=step,
        steps_remaining=answer["steps_remaining"],
        done=answer["done"],
        from_cache=from_cache,
        provider=llm.get_provider().name,
    )


@app.post("/sessions", response_model=AssistResponse, status_code=status.HTTP_201_CREATED, tags=["Assist"], responses={**ERRORS, 502: {"model": ErrorResponse}})
def start_session(body: StartSessionRequest, user: CurrentUser) -> AssistResponse:
    """User summoned Alfred and said where they're stuck: create a session and return step 1."""
    shot = _decode(body.screenshot)
    answer, from_cache = _ask_alfred(body.goal, shot, [], None)
    with get_db() as conn:
        session_id = conn.execute(
            "INSERT INTO help_sessions (user_id, goal, app_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (user["id"], body.goal.strip(), answer["app"], now_iso(), now_iso()),
        ).lastrowid
        conn.execute(
            "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
            (session_id, body.goal.strip(), now_iso()),
        )
        step = _record_answer(conn, session_id, answer, from_cache)
    return _response(session_id, answer, step, from_cache)


def _owned_session(conn: sqlite3.Connection, session_id: int, user_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM help_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return row


@app.post("/sessions/{session_id}/next", response_model=AssistResponse, tags=["Assist"], responses={**ERRORS, 502: {"model": ErrorResponse}})
def next_step(session_id: int, body: NextStepRequest, user: CurrentUser) -> AssistResponse:
    """User did the step (or asked a follow-up): look at the new screen and give the next step."""
    shot = _decode(body.screenshot)
    with get_db() as conn:
        session = _owned_session(conn, session_id, user["id"])
        if body.completed:
            conn.execute(
                """
                UPDATE steps SET completed = 1 WHERE id = (
                    SELECT id FROM steps WHERE session_id = ? AND completed = 0 ORDER BY position DESC LIMIT 1
                )
                """,
                (session_id,),
            )
        completed = [r["instruction"] for r in conn.execute(
            "SELECT instruction FROM steps WHERE session_id = ? AND completed = 1 ORDER BY position", (session_id,)
        )]
        if body.message:
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
                (session_id, body.message.strip(), now_iso()),
            )
        goal = session["goal"]

    answer, from_cache = _ask_alfred(goal, shot, completed, body.message)
    with get_db() as conn:
        step = _record_answer(conn, session_id, answer, from_cache)
    return _response(session_id, answer, step, from_cache)


def _step_out(row: sqlite3.Row) -> StepOut:
    box = [row["box_ymin"], row["box_xmin"], row["box_ymax"], row["box_xmax"]]
    return StepOut(
        id=row["id"], position=row["position"], instruction=row["instruction"], target_label=row["target_label"],
        action=row["action"] or "click", box_2d=box if None not in box else None,
    )


SUMMARY_SQL = """
SELECT s.*, (SELECT COUNT(*) FROM steps WHERE session_id = s.id) AS step_count
FROM help_sessions s WHERE s.user_id = ?
"""


@app.get("/sessions", response_model=list[SessionSummary], tags=["Assist"], responses=ERRORS)
def list_sessions(user: CurrentUser, limit: int = 20, offset: int = 0) -> list[SessionSummary]:
    limit = max(1, min(limit, 100))
    with get_db() as conn:
        rows = conn.execute(SUMMARY_SQL + " ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?", (user["id"], limit, max(0, offset))).fetchall()
    return [SessionSummary(**{k: r[k] for k in SessionSummary.model_fields}) for r in rows]


@app.get("/sessions/{session_id}", response_model=SessionDetail, tags=["Assist"], responses=ERRORS)
def get_session(session_id: int, user: CurrentUser) -> SessionDetail:
    with get_db() as conn:
        _owned_session(conn, session_id, user["id"])
        row = conn.execute(SUMMARY_SQL + " AND s.id = ?", (user["id"], session_id)).fetchone()
        steps = conn.execute("SELECT * FROM steps WHERE session_id = ? ORDER BY position", (session_id,)).fetchall()
        messages = conn.execute("SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id", (session_id,)).fetchall()
    return SessionDetail(
        **{k: row[k] for k in SessionSummary.model_fields},
        steps=[_step_out(s) for s in steps],
        messages=[dict(m) for m in messages],
    )


@app.patch("/sessions/{session_id}", response_model=SessionSummary, tags=["Assist"], responses=ERRORS)
def update_session(session_id: int, body: StatusUpdate, user: CurrentUser) -> SessionSummary:
    """Mark a session solved (the user says it worked) or abandoned."""
    with get_db() as conn:
        _owned_session(conn, session_id, user["id"])
        if body.status == "solved":
            conn.execute("UPDATE steps SET completed = 1 WHERE session_id = ?", (session_id,))
        conn.execute("UPDATE help_sessions SET status = ?, updated_at = ? WHERE id = ?", (body.status, now_iso(), session_id))
        row = conn.execute(SUMMARY_SQL + " AND s.id = ?", (user["id"], session_id)).fetchone()
    return SessionSummary(**{k: row[k] for k in SessionSummary.model_fields})


@app.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Assist"], responses=ERRORS)
def delete_session(session_id: int, user: CurrentUser) -> Response:
    with get_db() as conn:
        _owned_session(conn, session_id, user["id"])
        conn.execute("DELETE FROM help_sessions WHERE id = ?", (session_id,))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/stats", tags=["Assist"], responses=ERRORS)
def my_stats(user: CurrentUser) -> dict:
    with get_db() as conn:
        totals = conn.execute(
            """
            SELECT COUNT(*) AS sessions,
                   COALESCE(SUM(status = 'solved'), 0) AS solved,
                   COALESCE(SUM(status = 'abandoned'), 0) AS abandoned
            FROM help_sessions WHERE user_id = ?
            """,
            (user["id"],),
        ).fetchone()
        steps = conn.execute(
            """
            SELECT COUNT(*) AS steps, COALESCE(SUM(st.from_cache), 0) AS cached
            FROM steps st JOIN help_sessions s ON s.id = st.session_id WHERE s.user_id = ?
            """,
            (user["id"],),
        ).fetchone()
        apps = conn.execute(
            """
            SELECT COALESCE(app_name, 'Unknown app') AS app, COUNT(*) AS sessions FROM help_sessions
            WHERE user_id = ? GROUP BY app ORDER BY sessions DESC LIMIT 5
            """,
            (user["id"],),
        ).fetchall()
    return {**dict(totals), "steps": steps["steps"], "cached_steps": steps["cached"], "top_apps": [dict(a) for a in apps]}


# ---------------------------------------------------------------- tasks & reminders

@app.get("/tasks", response_model=list[TaskOut], tags=["Tasks"], responses=ERRORS)
def list_tasks(user: CurrentUser) -> list[dict]:
    with get_db() as conn:
        return tasks.list_tasks(conn, user["id"])


@app.post("/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED, tags=["Tasks"], responses=ERRORS)
def create_task(body: TaskCreate, user: CurrentUser) -> dict:
    with get_db() as conn:
        return tasks.create_task(conn, user["id"], body.title, body.notes, body.remindAt)


@app.patch("/tasks/{task_id}", response_model=TaskOut, tags=["Tasks"], responses=ERRORS)
def update_task(task_id: str, body: TaskUpdate, user: CurrentUser) -> dict:
    sent = body.model_fields_set  # an explicit null clears notes / the reminder
    changes: dict = {"title": body.title, "done": body.done, "reminded": body.reminded}
    if "notes" in sent:
        changes["notes"] = body.notes
    if "remindAt" in sent:
        changes["remind_at"] = body.remindAt
    with get_db() as conn:
        task = tasks.update_task(conn, user["id"], task_id, **changes)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task


@app.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Tasks"], responses=ERRORS)
def delete_task(task_id: str, user: CurrentUser) -> Response:
    with get_db() as conn:
        if not tasks.delete_task(conn, user["id"], task_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/tasks/clear-completed", tags=["Tasks"], responses=ERRORS)
def clear_completed_tasks(user: CurrentUser) -> dict:
    with get_db() as conn:
        return {"removed": tasks.clear_completed(conn, user["id"])}


# ---------------------------------------------------------------- chat

@app.post("/chat", response_model=ChatResponse, tags=["Assist"], responses={**ERRORS, 502: {"model": ErrorResponse}})
def chat(body: ChatRequest, user: CurrentUser) -> dict:
    """The Ask box. Task requests are handled here; screen questions come back as look_at_screen."""
    try:
        return agent.chat(user["id"], body.message, [t.model_dump() for t in body.history], body.client_time)
    except llm.LLMError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error


# ---------------------------------------------------------------- reports

@app.get("/reports/weekly.pdf", tags=["Reports"], responses={200: {"content": {"application/pdf": {}}}, **ERRORS})
def weekly_report_pdf(user: CurrentUser) -> Response:
    start, end = reports.week_window()
    pdf = reports.build_pdf(reports.collect(user["id"], start, end))
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="alfred-weekly-report.pdf"'})


@app.post("/reports/email", status_code=status.HTTP_202_ACCEPTED, tags=["Reports"], responses=ERRORS)
def email_report(user: CurrentUser, background: BackgroundTasks) -> dict:
    """Builds and emails the report in the background so the app gets an instant answer."""
    background.add_task(reports.generate_and_email, user["id"])
    return {
        "queued": True,
        "email_enabled": config.EMAIL_ENABLED,
        "message": f"Your report is on its way to {user['email']}" if config.EMAIL_ENABLED
        else "Email is not configured on the server; the PDF was saved to the reports folder instead",
    }


# ---------------------------------------------------------------- jobs & cache

@app.get("/jobs", tags=["Jobs"], responses=ERRORS)
def job_status(user: CurrentUser) -> dict:
    with get_db() as conn:
        runs = conn.execute("SELECT job_name, detail, ran_at FROM job_runs ORDER BY id DESC LIMIT 20").fetchall()
    return {"scheduled": jobs.upcoming(), "recent_runs": [dict(r) for r in runs], "cache": cache.summary()}


@app.post("/jobs/{job_name}/run", tags=["Jobs"], responses=ERRORS)
def run_job(job_name: str, user: CurrentUser) -> dict:
    if user["email"].lower() not in config.ADMIN_EMAILS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can run jobs by hand")
    job = jobs.JOBS.get(job_name)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown job. Choose from: {', '.join(jobs.JOBS)}")
    return {"job": job_name, "result": job()}
