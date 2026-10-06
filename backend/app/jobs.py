"""Background jobs run by APScheduler inside the API process."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from . import cache, config, reports
from .db import get_db, log_job, now_iso

logger = logging.getLogger("alfred.jobs")


def weekly_reports() -> str:
    """Every week: build a PDF for each opted-in user who used Alfred, and email it."""
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(timespec="seconds")
    with get_db() as conn:
        user_ids = [
            row["id"]
            for row in conn.execute(
                """
                SELECT DISTINCT u.id FROM users u JOIN help_sessions s ON s.user_id = u.id
                WHERE u.weekly_report = 1 AND s.created_at >= ?
                """,
                (since,),
            )
        ]
    sent = 0
    for user_id in user_ids:
        try:
            sent += reports.generate_and_email(user_id)["emailed"]
        except Exception:  # one bad user must not stop the rest
            logger.exception("Weekly report failed for user %s", user_id)
    detail = f"{len(user_ids)} report(s) built, {sent} emailed"
    log_job("weekly_reports", detail)
    return detail


def purge_cache() -> str:
    detail = f"{cache.purge_expired()} expired cache entries removed"
    log_job("purge_cache", detail)
    return detail


def close_stale_sessions() -> str:
    """Sessions nobody touched for a while are marked abandoned so stats stay honest."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=config.STALE_SESSION_MINUTES)).isoformat(timespec="seconds")
    with get_db() as conn:
        closed = conn.execute(
            "UPDATE help_sessions SET status = 'abandoned', updated_at = ? WHERE status = 'active' AND updated_at < ?",
            (now_iso(), cutoff),
        ).rowcount
    detail = f"{closed} stale session(s) closed"
    log_job("close_stale_sessions", detail)
    return detail


def email_missed_reminders() -> str:
    """Reminders the desktop app didn't announce (it was closed) go out by email instead.

    The desktop gets a grace period first, so a running app always wins and nobody
    gets the same reminder twice.
    """
    if not config.EMAIL_ENABLED:
        detail = "email not configured, skipped"
        log_job("email_missed_reminders", detail)
        return detail
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=config.REMINDER_EMAIL_GRACE_MINUTES)).isoformat(timespec="seconds")
    with get_db() as conn:
        due = conn.execute(
            """
            SELECT t.id, t.title, t.notes, t.remind_at, u.email, u.name FROM tasks t JOIN users u ON u.id = t.user_id
            WHERE t.done = 0 AND t.reminded_at IS NULL AND t.remind_at IS NOT NULL AND t.remind_at <= ?
            """,
            (cutoff,),
        ).fetchall()
    sent = 0
    for task in due:
        body = f"Good day, {task['name']}.\n\nA gentle reminder: {task['title']}.\n"
        if task["notes"]:
            body += f"\n{task['notes']}\n"
        body += "\nAt your service,\nAlfred"
        try:
            if reports.send_email(task["email"], f"Reminder: {task['title']}", body):
                sent += 1
                with get_db() as conn:
                    conn.execute("UPDATE tasks SET reminded_at = ? WHERE id = ?", (now_iso(), task["id"]))
        except Exception:
            logger.exception("Reminder email failed for task %s", task["id"])
    detail = f"{sent} of {len(due)} missed reminder(s) emailed"
    log_job("email_missed_reminders", detail)
    return detail


JOBS = {
    "email_missed_reminders": email_missed_reminders,
    "weekly_reports": weekly_reports,
    "purge_cache": purge_cache,
    "close_stale_sessions": close_stale_sessions,
}

scheduler = BackgroundScheduler()  # server-local time, so "8 am Monday" means 8 am where it runs


def start() -> None:
    if scheduler.running:
        return
    scheduler.add_job(
        weekly_reports,
        CronTrigger(day_of_week=config.WEEKLY_REPORT_DAY, hour=config.WEEKLY_REPORT_HOUR, minute=0),
        id="weekly_reports",
        replace_existing=True,
    )
    scheduler.add_job(purge_cache, IntervalTrigger(hours=1), id="purge_cache", replace_existing=True)
    scheduler.add_job(email_missed_reminders, IntervalTrigger(minutes=5), id="email_missed_reminders", replace_existing=True)
    scheduler.add_job(close_stale_sessions, IntervalTrigger(minutes=30), id="close_stale_sessions", replace_existing=True)
    scheduler.start()
    logger.info("Scheduler started: %s", ", ".join(job.id for job in scheduler.get_jobs()))


def stop() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)


def upcoming() -> list[dict]:
    return [
        {"id": job.id, "next_run": job.next_run_time.isoformat() if job.next_run_time else None}
        for job in scheduler.get_jobs()
    ]
