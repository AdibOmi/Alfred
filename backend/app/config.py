"""All runtime settings come from environment variables (or backend/.env)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


PORT = int(os.getenv("PORT", "8000"))
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production-please-32+chars")
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", str(60 * 24 * 7)))
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(BASE_DIR / "alfred.db")))
REPORTS_DIR = Path(os.getenv("REPORTS_DIR", str(BASE_DIR / "reports")))

# LLM: "gemini" (free key from https://aistudio.google.com) or "mock" (offline demo / tests).
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini" if GEMINI_API_KEY else "mock").lower()
# Tried in order; the first model the key can reach wins.
GEMINI_MODELS = [m.strip() for m in os.getenv("GEMINI_MODEL", "gemini-3.5-flash,gemini-2.5-flash").split(",") if m.strip()]
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "45"))

CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", str(60 * 60 * 24)))
SCREENSHOT_MAX_WIDTH = int(os.getenv("SCREENSHOT_MAX_WIDTH", "1600"))

# Background jobs
SCHEDULER_ENABLED = _bool("SCHEDULER_ENABLED", True)
WEEKLY_REPORT_DAY = os.getenv("WEEKLY_REPORT_DAY", "mon")
WEEKLY_REPORT_HOUR = int(os.getenv("WEEKLY_REPORT_HOUR", "8"))
STALE_SESSION_MINUTES = int(os.getenv("STALE_SESSION_MINUTES", "120"))
REMINDER_EMAIL_GRACE_MINUTES = int(os.getenv("REMINDER_EMAIL_GRACE_MINUTES", "10"))

# Email (optional). A Gmail account + App Password works for free.
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
EMAIL_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

# Comma-separated emails allowed to trigger scheduled jobs by hand (POST /jobs/{name}/run).
ADMIN_EMAILS = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
