"""The chat brain behind Alfred's Ask box: a short tool loop that decides what a message needs.

The model gets five tools. Task tools run right here against the database. look_at_screen
ends the loop and tells the desktop app to take a screenshot and start a guided session,
so a message like "add milk to my list" never touches the screen at all.

Speed matters more than anything here, so the loop takes one model call in the common case:
once every task tool has succeeded, the confirmation is written from the tool results instead
of asking the model to phrase it. Only a failed tool call goes back to the model to sort out.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from . import llm, tasks
from .db import get_db

MAX_TOOL_TURNS = 6
MAX_HISTORY_TURNS = 8

TOOLS = [
    {
        "functionDeclarations": [
            {
                "name": "look_at_screen",
                "description": (
                    "Look at the user's screen and guide them on it. Call this whenever answering needs the screen: "
                    "how to do something in Word, Excel, PowerPoint, a browser or any app, what an error means, or "
                    "anything said as 'this', 'here' or 'what I'm looking at'. Do not call it for the task list or "
                    "for general knowledge."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {"goal": {"type": "STRING", "description": "What the user wants, in their own words."}},
                    "required": ["goal"],
                },
            },
            {
                "name": "create_task",
                "description": (
                    "Add a to-do. Include remind_at only when the user asked to be reminded at a time; without it the "
                    "entry is a plain to-do with no notification."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "title": {"type": "STRING", "description": "Short imperative summary, e.g. 'Call the dentist'."},
                        "notes": {"type": "STRING", "description": "Optional extra detail."},
                        "remind_at": {
                            "type": "STRING",
                            "description": "Local wall-clock time YYYY-MM-DDTHH:MM:SS, no timezone, resolved against the current time in the instructions.",
                        },
                    },
                    "required": ["title"],
                },
            },
            {
                "name": "update_task",
                "description": "Change a task. Use the exact id from the task list in the instructions.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "id": {"type": "STRING"},
                        "title": {"type": "STRING"},
                        "notes": {"type": "STRING"},
                        "remind_at": {"type": "STRING", "description": "New local wall-clock time YYYY-MM-DDTHH:MM:SS."},
                        "clear_reminder": {"type": "BOOLEAN", "description": "True to drop the reminder but keep the to-do."},
                    },
                    "required": ["id"],
                },
            },
            {
                "name": "complete_task",
                "description": "Mark a task done. Use the exact id from the task list.",
                "parameters": {"type": "OBJECT", "properties": {"id": {"type": "STRING"}}, "required": ["id"]},
            },
            {
                "name": "delete_task",
                "description": "Remove a task added by mistake or no longer relevant. Prefer complete_task when it was finished.",
                "parameters": {"type": "OBJECT", "properties": {"id": {"type": "STRING"}}, "required": ["id"]},
            },
        ]
    }
]


def client_zone(client_time: str | None) -> tuple[datetime, timezone]:
    """The user's 'now' and timezone, taken from the desktop app's clock (falls back to UTC)."""
    if client_time:
        try:
            now = datetime.fromisoformat(client_time.replace("Z", "+00:00"))
            if now.tzinfo is not None:
                return now, now.tzinfo  # type: ignore[return-value]
        except ValueError:
            pass
    now = datetime.now(timezone.utc)
    return now, timezone.utc


def _local(iso: str | None, tz: timezone) -> str:
    return datetime.fromisoformat(iso).astimezone(tz).strftime("%a %d %b %Y %H:%M") if iso else ""


def friendly_when(iso: str, tz: timezone, now: datetime) -> str:
    """'today at 5:00 PM', 'tomorrow at 9:30 AM', 'Fri 10 Oct at 5:00 PM'."""
    when = datetime.fromisoformat(iso).astimezone(tz)
    clock = when.strftime("%I:%M %p").lstrip("0")
    days = (when.date() - now.astimezone(tz).date()).days
    if days == 0:
        return f"today at {clock}"
    if days == 1:
        return f"tomorrow at {clock}"
    if days == -1:
        return f"yesterday at {clock}"
    return f"{when.strftime('%a')} {when.day} {when.strftime('%b')} at {clock}"


TOOL_SPECS = TOOLS[0]["functionDeclarations"]


def _openai_schema(schema: dict) -> dict:
    """Gemini's upper-case schema types, rewritten for an OpenAI-style API."""
    out = {key: value for key, value in schema.items() if key not in {"type", "properties"}}
    out["type"] = schema["type"].lower()
    if "properties" in schema:
        out["properties"] = {name: _openai_schema(prop) for name, prop in schema["properties"].items()}
    return out


OPENAI_TOOLS = [
    {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": _openai_schema(t["parameters"])}}
    for t in TOOL_SPECS
]


def system_prompt(task_list: list[dict], now: datetime, tz: timezone) -> str:
    def line(t: dict) -> str:
        parts = [f"- id={t['id']} | {t['title']}"]
        if t["notes"]:
            parts.append(f"notes: {t['notes']}")
        if t["remindAt"]:
            parts.append(f"reminder: {_local(t['remindAt'], tz)}")
        if t["done"]:
            parts.append("status: done")
        return " | ".join(parts)

    open_tasks = [t for t in task_list if not t["done"]]
    done_tasks = [t for t in task_list if t["done"]][:5]
    task_section = "\n\n".join(filter(None, [
        "Open tasks:\n" + "\n".join(map(line, open_tasks)) if open_tasks else "No open tasks.",
        "Recently completed:\n" + "\n".join(map(line, done_tasks)) if done_tasks else "",
    ]))
    return "\n".join([
        "You are Alfred, a calm, courteous butler that lives on the user's desktop. You do two things: guide",
        "people through software on their screen, and keep their to-dos and reminders.",
        "",
        f"Current local time: {now.strftime('%A %d %B %Y, %H:%M')} (UTC{now.strftime('%z')}).",
        "",
        task_section,
        "",
        "How to answer:",
        "- Anything about the screen or how to do something in an app: call look_at_screen with the goal.",
        "  Never ask which app they are in; looking will tell you.",
        "- To-dos and reminders: call the task tools, then confirm in one short sentence and say the time back",
        "  in plain words, e.g. 'Reminder set for 5pm today.' Never invent a time. If 'remind me later' has no",
        "  usable time, ask for one.",
        "- Resolve 'tomorrow morning', 'in 20 minutes', 'next Tuesday' against the current local time above.",
        "- No preamble. Keep replies short: this shows in a panel about 380 pixels wide.",
    ])


def _contents(history: list[dict], message: str) -> list[dict]:
    recent = history[-MAX_HISTORY_TURNS:]
    first_user = next((i for i, t in enumerate(recent) if t.get("role") == "user"), len(recent))
    contents = [
        {"role": "user" if t["role"] == "user" else "model", "parts": [{"text": str(t.get("content", ""))[:4000]}]}
        for t in recent[first_user:]
        if t.get("content")
    ]
    contents.append({"role": "user", "parts": [{"text": message}]})
    return contents


def _run_tool(name: str, args: dict, user_id: int, tz: timezone, now: datetime, outcome: dict) -> tuple[str, str | None]:
    """Executes one task tool.

    Returns (what the model sees as the result, what the user is told). The second is None when
    the call failed, which is the signal to hand the result back to the model.
    """
    def local_to_utc(value: str | None) -> str | None:
        return tasks.parse_time(value, assume_tz=tz)

    def reminder(task: dict) -> str:
        return f", reminder set for {friendly_when(task['remindAt'], tz, now)}" if task["remindAt"] else ""

    with get_db() as conn:
        if name == "create_task":
            title = str(args.get("title") or "").strip()
            if not title:
                return "Error: a task needs a title.", None
            task = tasks.create_task(conn, user_id, title, args.get("notes"), local_to_utc(args.get("remind_at")))
            outcome["changed_tasks"] = True
            when = f" with a reminder at {_local(task['remindAt'], tz)}" if task["remindAt"] else " with no reminder"
            told = (
                f"Reminder set for {friendly_when(task['remindAt'], tz, now)}: \u201c{task['title']}\u201d."
                if task["remindAt"]
                else f"Added \u201c{task['title']}\u201d to your list."
            )
            return f"Created task id={task['id']} \"{task['title']}\"{when}.", told
        if name == "update_task":
            changes: dict = {}
            if args.get("title"):
                changes["title"] = args["title"]
            if "notes" in args:
                changes["notes"] = args["notes"]
            if args.get("clear_reminder"):
                changes["remind_at"] = None
            elif args.get("remind_at"):
                changes["remind_at"] = local_to_utc(args["remind_at"])
            task = tasks.update_task(conn, user_id, str(args.get("id", "")), **changes)
            if task is None:
                return f"Error: no task with id={args.get('id')}.", None
            outcome["changed_tasks"] = True
            dropped = ", reminder removed" if args.get("clear_reminder") else ""
            return f"Updated \"{task['title']}\".", f"Updated \u201c{task['title']}\u201d{reminder(task) or dropped}."
        if name == "complete_task":
            task = tasks.update_task(conn, user_id, str(args.get("id", "")), done=True)
            if task is None:
                return f"Error: no task with id={args.get('id')}.", None
            outcome["changed_tasks"] = True
            return f"Marked \"{task['title']}\" done.", f"Marked \u201c{task['title']}\u201d done."
        if name == "delete_task":
            task_id = str(args.get("id", ""))
            title = next((t["title"] for t in tasks.list_tasks(conn, user_id) if t["id"] == task_id), None)
            if title is None or not tasks.delete_task(conn, user_id, task_id):
                return f"Error: no task with id={args.get('id')}.", None
            outcome["changed_tasks"] = True
            return "Task deleted.", f"Deleted \u201c{title}\u201d."
    return f"Error: unknown tool {name}.", None


def chat(user_id: int, message: str, history: list[dict], client_time: str | None) -> dict:
    provider = llm.get_provider()
    if isinstance(provider, llm.MockProvider):
        return mock_chat(user_id, message, client_time)
    if getattr(provider, "dialect", "gemini") == "openai":
        return _chat_openai(provider, user_id, message, history, client_time)

    now, tz = client_zone(client_time)
    outcome = {"reply": "", "changed_tasks": False, "look_at_screen": None}
    contents = _contents(history, message)

    for _ in range(MAX_TOOL_TURNS):
        with get_db() as conn:
            task_list = tasks.list_tasks(conn, user_id)
        data = provider.generate({
            "system_instruction": {"parts": [{"text": system_prompt(task_list, now, tz)}]},
            "contents": contents,
            "tools": TOOLS,
            "generationConfig": {"temperature": 0.3},
        })
        try:
            content = data["candidates"][0]["content"]
        except (KeyError, IndexError) as error:
            raise llm.LLMError("Alfred got an empty answer from the model, please try again") from error
        parts = content.get("parts", [])
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        text = "\n".join(p["text"].strip() for p in parts if p.get("text") and not p.get("thought")).strip()

        if not calls:
            outcome["reply"] = text or "Done."
            return outcome

        # The model's turn goes back verbatim (thought signatures included), then every result in one turn.
        contents.append(content)
        responses, confirmations = [], []
        for call in calls:
            name, args = call.get("name", ""), call.get("args") or {}
            if name == "look_at_screen":
                outcome["look_at_screen"] = {"goal": str(args.get("goal") or message)[:500]}
                outcome["reply"] = text
                continue
            result, confirmation = _run_tool(name, args, user_id, tz, now, outcome)
            confirmations.append(confirmation)
            responses.append({"functionResponse": {"name": name, "response": {"result": result}}})
        if outcome["look_at_screen"]:
            return outcome
        if confirmations and None not in confirmations:
            outcome["reply"] = " ".join(confirmations)
            return outcome
        contents.append({"role": "user", "parts": responses})

    raise llm.LLMError("Alfred got stuck working that out. Try asking a simpler question.")


def _chat_openai(provider, user_id: int, message: str, history: list[dict], client_time: str | None) -> dict:
    """The same loop as chat(), for providers with an OpenAI-style API (Groq)."""
    now, tz = client_zone(client_time)
    outcome = {"reply": "", "changed_tasks": False, "look_at_screen": None}
    messages = [
        {"role": "user" if c["role"] == "user" else "assistant", "content": c["parts"][0]["text"]}
        for c in _contents(history, message)
    ]

    for _ in range(MAX_TOOL_TURNS):
        with get_db() as conn:
            task_list = tasks.list_tasks(conn, user_id)
        data = provider.complete({
            "model": provider.chat_model,
            "temperature": 0.3,
            "reasoning_effort": "low",
            "tools": OPENAI_TOOLS,
            "messages": [{"role": "system", "content": system_prompt(task_list, now, tz)}, *messages],
        })
        try:
            reply = data["choices"][0]["message"]
        except (KeyError, IndexError) as error:
            raise llm.LLMError("Alfred got an empty answer from the model, please try again") from error
        calls = reply.get("tool_calls") or []
        text = (reply.get("content") or "").strip()

        if not calls:
            outcome["reply"] = text or "Done."
            return outcome

        messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": calls})
        confirmations = []
        for call in calls:
            name = call.get("function", {}).get("name", "")
            try:
                args = json.loads(call.get("function", {}).get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if name == "look_at_screen":
                outcome["look_at_screen"] = {"goal": str(args.get("goal") or message)[:500]}
                outcome["reply"] = text
                return outcome
            result, confirmation = _run_tool(name, args, user_id, tz, now, outcome)
            confirmations.append(confirmation)
            messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": result})
        if confirmations and None not in confirmations:
            outcome["reply"] = " ".join(confirmations)
            return outcome

    raise llm.LLMError("Alfred got stuck working that out. Try asking a simpler question.")


# ---------------------------------------------------------------- offline stand-in

_REMIND = re.compile(
    r"remind me (?:to )?(?P<title>.+?) (?:at|by) (?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ap>am|pm)?\s*(?P<tomorrow>tomorrow)?\s*[.!]?$",
    re.IGNORECASE,
)
_ADD = re.compile(r"^(?:please )?(?:add|put) (?P<title>.+?) (?:to|on) my (?:list|tasks|to-?do(?: list)?)\s*[.!]?$", re.IGNORECASE)
_DONE = re.compile(r"^(?:mark|complete|finish|tick)\s+(?:the\s+)?(?P<title>.+?)(?:\s+(?:as\s+)?done)?\s*[.!]?$", re.IGNORECASE)


def mock_chat(user_id: int, message: str, client_time: str | None) -> dict:
    """Rule-based version of the loop above, so tests and demos run without a key."""
    now, tz = client_zone(client_time)
    outcome = {"reply": "", "changed_tasks": False, "look_at_screen": None}
    text = message.strip()

    if match := _REMIND.search(text):
        hour, minute = int(match["h"]), int(match["m"] or 0)
        if match["ap"]:
            hour = hour % 12 + (12 if match["ap"].lower() == "pm" else 0)
        when = now.replace(hour=hour % 24, minute=minute, second=0, microsecond=0)
        if match["tomorrow"] or when <= now:
            when += timedelta(days=1)
        with get_db() as conn:
            tasks.create_task(conn, user_id, match["title"].strip().capitalize(), None, when.isoformat())
        day = "tomorrow" if when.date() > now.date() else "today"
        outcome.update(changed_tasks=True, reply=f"Reminder set for {when.strftime('%H:%M')} {day}.")
        return outcome

    if match := _ADD.search(text):
        with get_db() as conn:
            task = tasks.create_task(conn, user_id, match["title"].strip().capitalize())
        outcome.update(changed_tasks=True, reply=f"Added \"{task['title']}\" to your list.")
        return outcome

    if match := _DONE.search(text):
        wanted = match["title"].lower().removesuffix(" one").strip()
        with get_db() as conn:
            for task in tasks.list_tasks(conn, user_id):
                if not task["done"] and (wanted in task["title"].lower() or task["title"].lower() in wanted):
                    tasks.update_task(conn, user_id, task["id"], done=True)
                    outcome.update(changed_tasks=True, reply=f"Marked \"{task['title']}\" done.")
                    return outcome

    outcome["look_at_screen"] = {"goal": text}
    return outcome

