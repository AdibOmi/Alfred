"""Weekly "What you learned" PDF: stats plus a personal cheat sheet of every task Alfred walked you through."""
from __future__ import annotations

import logging
import smtplib
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

from fpdf import FPDF

from . import config
from .db import get_db, now_iso

logger = logging.getLogger("alfred.reports")

INK = (31, 35, 48)
MUTED = (110, 116, 135)
ACCENT = (176, 132, 52)   # Alfred's brass
PANEL = (245, 242, 235)


def _latin1(text: str | None) -> str:
    """Core PDF fonts only cover Latin-1; swap the usual offenders and drop the rest."""
    text = (text or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("—", "-").replace("…", "...").replace("→", "->")
    return text.encode("latin-1", "ignore").decode("latin-1")


def collect(user_id: int, start: datetime, end: datetime) -> dict:
    with get_db() as conn:
        user = dict(conn.execute("SELECT id, email, name FROM users WHERE id = ?", (user_id,)).fetchone())
        sessions = [
            dict(r)
            for r in conn.execute(
                """
                SELECT id, goal, app_name, status, created_at FROM help_sessions
                WHERE user_id = ? AND created_at >= ? AND created_at < ?
                ORDER BY created_at
                """,
                (user_id, start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds")),
            )
        ]
        for session in sessions:
            session["steps"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT instruction, completed, from_cache FROM steps WHERE session_id = ? ORDER BY position",
                    (session["id"],),
                )
            ]

        tasks_done = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE user_id = ? AND done = 1 AND completed_at >= ? AND completed_at < ?",
            (user_id, start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds")),
        ).fetchone()[0]
        open_tasks = [
            dict(r)
            for r in conn.execute(
                "SELECT title, remind_at FROM tasks WHERE user_id = ? AND done = 0 "
                "ORDER BY remind_at IS NULL, remind_at, created_at LIMIT 10",
                (user_id,),
            )
        ]

    steps = [s for session in sessions for s in session["steps"]]
    statuses = Counter(s["status"] for s in sessions)
    apps = Counter(s["app_name"] or "Unknown app" for s in sessions)
    return {
        "user": user,
        "start": start,
        "end": end,
        "sessions": sessions,
        "totals": {
            "sessions": len(sessions),
            "solved": statuses.get("solved", 0),
            "abandoned": statuses.get("abandoned", 0),
            "steps": len(steps),
            "cached_steps": sum(1 for s in steps if s["from_cache"]),
            "tasks_done": tasks_done,
        },
        "open_tasks": open_tasks,
        "top_apps": apps.most_common(5),
    }


class _ReportPDF(FPDF):
    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 8, f"Alfred - your personal software butler  |  page {self.page_no()}", align="C")


def build_pdf(data: dict) -> bytes:
    pdf = _ReportPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(18, 18, 18)
    pdf.add_page()

    # Header band
    pdf.set_fill_color(*INK)
    pdf.rect(0, 0, pdf.w, 38, style="F")
    pdf.set_xy(18, 10)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 9, "Your week with Alfred", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*ACCENT)
    period = f"{data['start']:%d %b %Y} - {(data['end'] - timedelta(seconds=1)):%d %b %Y}"
    pdf.cell(0, 6, _latin1(f"{data['user']['name']}  |  {period}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(46)

    # Stat tiles
    totals = data["totals"]
    tiles = [
        ("Times you asked", totals["sessions"]),
        ("Tasks solved", totals["solved"]),
        ("Steps guided", totals["steps"]),
        ("To-dos finished", totals["tasks_done"]),
    ]
    tile_w = (pdf.w - 36 - 3 * 4) / 4
    y = pdf.get_y()
    for i, (label, value) in enumerate(tiles):
        x = 18 + i * (tile_w + 4)
        pdf.set_fill_color(*PANEL)
        pdf.rect(x, y, tile_w, 22, style="F")
        pdf.set_xy(x, y + 3)
        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(*INK)
        pdf.cell(tile_w, 8, str(value), align="C")
        pdf.set_xy(x, y + 12)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(*MUTED)
        pdf.cell(tile_w, 6, label, align="C")
    pdf.set_y(y + 30)

    def heading(text: str) -> None:
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(*INK)
        pdf.cell(0, 8, text, new_x="LMARGIN", new_y="NEXT")
        pdf.set_draw_color(*ACCENT)
        pdf.set_line_width(0.6)
        pdf.line(18, pdf.get_y(), 40, pdf.get_y())
        pdf.ln(3)

    if data["top_apps"]:
        heading("Where you needed a hand")
        pdf.set_font("Helvetica", "", 10)
        biggest = data["top_apps"][0][1]
        for app, count in data["top_apps"]:
            pdf.set_text_color(*INK)
            pdf.cell(55, 7, _latin1(app)[:32])
            bar = max(2, 100 * count / biggest)
            pdf.set_fill_color(*ACCENT)
            pdf.rect(pdf.get_x(), pdf.get_y() + 1.5, bar, 4, style="F")
            pdf.set_x(pdf.get_x() + bar + 3)
            pdf.set_text_color(*MUTED)
            pdf.cell(0, 7, f"{count}x", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)

    heading("Your cheat sheet")
    if not data["sessions"]:
        pdf.set_font("Helvetica", "I", 10)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(0, 6, "No guided sessions this week. Press Ctrl+Shift+A whenever you get stuck and Alfred will step in.")
    for session in data["sessions"]:
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(*INK)
        badge = {"solved": "SOLVED", "abandoned": "UNFINISHED"}.get(session["status"], "IN PROGRESS")
        pdf.multi_cell(0, 6, _latin1(f"{session['goal']}"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(*MUTED)
        created = datetime.fromisoformat(session["created_at"])
        pdf.cell(0, 5, _latin1(f"{session['app_name'] or 'Unknown app'}  |  {created:%a %d %b, %H:%M} UTC  |  {badge}"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*INK)
        for n, step in enumerate(session["steps"], 1):
            pdf.set_x(24)
            pdf.multi_cell(0, 5.5, _latin1(f"{n}. {step['instruction']}"), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)

    if data["open_tasks"]:
        pdf.ln(2)
        heading("Still on your list")
        pdf.set_font("Helvetica", "", 10)
        for task in data["open_tasks"]:
            pdf.set_text_color(*INK)
            when = ""
            if task["remind_at"]:
                when = f"  (reminder {datetime.fromisoformat(task['remind_at']):%a %d %b, %H:%M} UTC)"
            pdf.set_x(24)
            pdf.multi_cell(0, 5.5, _latin1(f"- {task['title']}{when}"), new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())


def week_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    end = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    return end - timedelta(days=7), end


def save_report(user_id: int, start: datetime, end: datetime) -> tuple[Path, dict]:
    data = collect(user_id, start, end)
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = config.REPORTS_DIR / f"user{user_id}-{end:%Y%m%d-%H%M%S}.pdf"
    path.write_bytes(build_pdf(data))
    with get_db() as conn:
        conn.execute(
            "INSERT INTO reports (user_id, period_start, period_end, file_path, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds"), str(path), now_iso()),
        )
    return path, data


def send_email(to: str, subject: str, body: str, attachment: Path | None = None) -> bool:
    if not config.EMAIL_ENABLED:
        logger.info("Email not configured; skipped sending '%s' to %s", subject, to)
        return False
    message = EmailMessage()
    message["From"] = config.SMTP_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    if attachment:
        message.add_attachment(attachment.read_bytes(), maintype="application", subtype="pdf", filename="alfred-weekly-report.pdf")
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
        smtp.send_message(message)
    return True


def generate_and_email(user_id: int) -> dict:
    """Used by both the weekly cron job and the 'email me my report' endpoint."""
    start, end = week_window()
    path, data = save_report(user_id, start, end)
    totals = data["totals"]
    body = (
        f"Good day, {data['user']['name']}.\n\n"
        f"This week you called on me {totals['sessions']} time(s), solved {totals['solved']} task(s) "
        f"followed {totals['steps']} guided step(s) and finished {totals['tasks_done']} to-do(s). "
        "Your personal cheat sheet is attached.\n\n"
        "At your service,\nAlfred"
    )
    emailed = False
    try:
        emailed = send_email(data["user"]["email"], "Your week with Alfred", body, path)
    except (smtplib.SMTPException, OSError) as error:
        logger.warning("Email to %s failed: %s", data["user"]["email"], error)
    if emailed:
        with get_db() as conn:
            conn.execute("UPDATE reports SET emailed = 1 WHERE file_path = ?", (str(path),))
    return {"file": path.name, "emailed": emailed, **totals}
