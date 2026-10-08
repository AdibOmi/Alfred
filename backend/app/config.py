"""All runtime settings come from environment variables (or backend/.env)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
# The repo-root .env is a fallback, so a key already kept there (GROQ_API_KEY, GEMINI_API_KEY)
# works without copying it. load_dotenv never overrides a value that is already set.
load_dotenv(BASE_DIR.parent / ".env")


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


PORT = int(os.getenv("PORT", "8000"))
def _secret_key() -> str:
    """SECRET_KEY from the environment, else a random one generated once and kept beside the code.

    A fixed fallback would let a token signed for one database's user id sign in as whoever holds
    that id in another, so a fresh install gets its own key instead.
    """
    configured = os.getenv("SECRET_KEY", "").strip()
    if configured and configured != "change-me":
        return configured
    key_file = BASE_DIR / ".secret_key"
    try:
        return key_file.read_text().strip() or _new_secret(key_file)
    except FileNotFoundError:
        return _new_secret(key_file)


def _new_secret(key_file: Path) -> str:
    import secrets

    key = secrets.token_urlsafe(48)
    key_file.write_text(key)
    return key


SECRET_KEY = _secret_key()
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", str(60 * 24 * 7)))
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(BASE_DIR / "alfred.db")))
REPORTS_DIR = Path(os.getenv("REPORTS_DIR", str(BASE_DIR / "reports")))

# LLM providers, all with free tiers:
#   "gemini" - free key from https://aistudio.google.com/apikey (best at pointing at things)
#   "groq"   - free key from https://console.groq.com/keys (fastest answers)
#   "mock"   - offline demo / tests
# Without LLM_PROVIDER the first provider with a key wins, in the order above.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini" if GEMINI_API_KEY else "groq" if GROQ_API_KEY else "mock").lower()
# Tried in order; the first model the key can reach wins.
GEMINI_MODELS = [m.strip() for m in os.getenv("GEMINI_MODEL", "gemini-3.5-flash,gemini-2.5-flash").split(",") if m.strip()]
# Groq: a vision model reads the screen, a text model runs the chat tool loop.
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
GROQ_CHAT_MODEL = os.getenv("GROQ_CHAT_MODEL", "openai/gpt-oss-120b")
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
