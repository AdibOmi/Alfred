from datetime import datetime, timedelta, timezone

from app import jobs
from app.tasks import parse_time


def test_task_crud_round_trip(client, auth):
    created = client.post("/tasks", json={"title": "  Call the dentist ", "remindAt": "2030-01-02T09:30:00+06:00"}, headers=auth)
    assert created.status_code == 201
    task = created.json()
    assert task["title"] == "Call the dentist"
    assert task["remindAt"] == "2030-01-02T03:30:00+00:00"  # stored in UTC
    assert task["done"] is False and task["remindedAt"] is None

    done = client.patch(f"/tasks/{task['id']}", json={"done": True}, headers=auth).json()
    assert done["done"] is True and done["completedAt"] is not None

    reopened = client.patch(f"/tasks/{task['id']}", json={"done": False}, headers=auth).json()
    assert reopened["completedAt"] is None

    assert client.delete(f"/tasks/{task['id']}", headers=auth).status_code == 204
    assert client.get("/tasks", headers=auth).json() == []


def test_moving_a_reminder_rearms_it(client, auth):
    task = client.post("/tasks", json={"title": "Submit form", "remindAt": "2030-01-01T10:00:00Z"}, headers=auth).json()
    reminded = client.patch(f"/tasks/{task['id']}", json={"reminded": True}, headers=auth).json()
    assert reminded["remindedAt"] is not None
    moved = client.patch(f"/tasks/{task['id']}", json={"remindAt": "2030-01-01T11:00:00Z"}, headers=auth).json()
    assert moved["remindedAt"] is None

    cleared = client.patch(f"/tasks/{task['id']}", json={"remindAt": None}, headers=auth).json()
    assert cleared["remindAt"] is None and cleared["title"] == "Submit form"


def test_task_order_and_clear_completed(client, auth):
    later = client.post("/tasks", json={"title": "Later", "remindAt": "2030-05-01T10:00:00Z"}, headers=auth).json()
    sooner = client.post("/tasks", json={"title": "Sooner", "remindAt": "2030-01-01T10:00:00Z"}, headers=auth).json()
    plain = client.post("/tasks", json={"title": "Plain"}, headers=auth).json()
    client.patch(f"/tasks/{plain['id']}", json={"done": True}, headers=auth)

    titles = [t["title"] for t in client.get("/tasks", headers=auth).json()]
    assert titles == ["Sooner", "Later", "Plain"]  # soonest reminder first, finished last

    assert client.post("/tasks/clear-completed", headers=auth).json() == {"removed": 1}
    assert {t["id"] for t in client.get("/tasks", headers=auth).json()} == {later["id"], sooner["id"]}


def test_tasks_are_private(client, auth):
    task = client.post("/tasks", json={"title": "Mine"}, headers=auth).json()
    other = client.post("/auth/signup", json={"name": "Other", "email": "other-tasks@example.com", "password": "password123"}).json()
    headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/tasks", headers=headers).json() == []
    assert client.patch(f"/tasks/{task['id']}", json={"done": True}, headers=headers).status_code == 404
    assert client.delete(f"/tasks/{task['id']}", headers=headers).status_code == 404


def test_chat_creates_a_reminder_in_the_users_timezone(client, auth):
    res = client.post(
        "/chat",
        json={"message": "Remind me to submit the form at 4pm", "client_time": "2030-03-10T09:00:00+06:00"},
        headers=auth,
    ).json()
    assert res["changed_tasks"] is True and res["look_at_screen"] is None
    assert "16:00 today" in res["reply"]
    task = client.get("/tasks", headers=auth).json()[0]
    assert task["title"] == "Submit the form"
    assert task["remindAt"] == "2030-03-10T10:00:00+00:00"  # 4pm in UTC+6


def test_chat_adds_and_completes_tasks(client, auth):
    client.post("/chat", json={"message": "add buy milk to my list"}, headers=auth)
    assert client.get("/tasks", headers=auth).json()[0]["title"] == "Buy milk"
    res = client.post("/chat", json={"message": "mark buy milk done"}, headers=auth).json()
    assert res["reply"] == 'Marked "Buy milk" done.'
    assert client.get("/tasks", headers=auth).json()[0]["done"] is True


def test_screen_questions_hand_off_to_a_guided_session(client, auth):
    res = client.post("/chat", json={"message": "How do I make a pie chart in Excel?"}, headers=auth).json()
    assert res["changed_tasks"] is False
    assert res["look_at_screen"] == {"goal": "How do I make a pie chart in Excel?"}
    assert client.get("/tasks", headers=auth).json() == []


def test_chat_validation(client, auth):
    assert client.post("/chat", json={"message": ""}, headers=auth).status_code == 400
    assert client.post("/chat", json={"message": "hi"}).status_code == 401


def test_missed_reminder_job_skips_without_email(client, auth):
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    task = client.post("/tasks", json={"title": "Overdue thing", "remindAt": past}, headers=auth).json()
    assert jobs.email_missed_reminders() == "email not configured, skipped"
    # Not marked as reminded, so the desktop app still announces it next time it runs.
    assert client.get("/tasks", headers=auth).json()[0]["remindedAt"] is None
    assert task["id"]


def test_missed_reminder_job_emails_once(client, auth, monkeypatch):
    from app import config, reports

    sent = []
    monkeypatch.setattr(config, "EMAIL_ENABLED", True)
    monkeypatch.setattr(reports, "send_email", lambda to, subject, body, attachment=None: sent.append(subject) or True)
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    client.post("/tasks", json={"title": "Pay rent", "remindAt": past}, headers=auth)

    jobs.email_missed_reminders()
    jobs.email_missed_reminders()
    assert sent.count("Reminder: Pay rent") == 1
    assert client.get("/tasks", headers=auth).json()[0]["remindedAt"] is not None


def test_weekly_report_includes_tasks(client, auth):
    task = client.post("/tasks", json={"title": "Finish essay"}, headers=auth).json()
    client.patch(f"/tasks/{task['id']}", json={"done": True}, headers=auth)
    client.post("/tasks", json={"title": "Read chapter 4"}, headers=auth)
    from app import reports

    me = client.get("/auth/me", headers=auth).json()
    start, end = reports.week_window(datetime.now(timezone.utc) + timedelta(minutes=1))
    data = reports.collect(me["id"], start, end)
    assert data["totals"]["tasks_done"] == 1
    assert [t["title"] for t in data["open_tasks"]] == ["Read chapter 4"]
    assert reports.build_pdf(data).startswith(b"%PDF")


def test_parse_time_reads_naive_values_in_the_given_zone():
    plus6 = timezone(timedelta(hours=6))
    assert parse_time("2030-01-01T16:00:00", assume_tz=plus6) == "2030-01-01T10:00:00+00:00"
    assert parse_time("2030-01-01T10:00:00.000Z") == "2030-01-01T10:00:00+00:00"
    assert parse_time("not a date") is None and parse_time("") is None


class ScriptedGemini:
    """Stands in for GeminiProvider.generate with canned responses, recording what it was sent."""

    name, model = "gemini", "scripted"

    def __init__(self, turns):
        self.turns, self.bodies = list(turns), []

    def generate(self, body):
        self.bodies.append(body)
        return {"candidates": [{"content": {"role": "model", "parts": self.turns.pop(0)}}]}


def test_gemini_tool_loop_runs_task_tools_then_answers(client, auth, monkeypatch):
    from app import llm

    fake = ScriptedGemini([
        [{"functionCall": {"name": "create_task", "args": {"title": "Call mum", "remind_at": "2030-02-01T18:00:00"}}, "thoughtSignature": "abc"}],
        [{"text": "Reminder set for 6pm on 1 February."}],
    ])
    monkeypatch.setattr(llm, "get_provider", lambda: fake)
    res = client.post(
        "/chat",
        json={"message": "remind me to call mum on feb 1 at 6pm", "client_time": "2030-01-15T12:00:00+06:00",
              "history": [{"role": "assistant", "content": "hello"}, {"role": "user", "content": "hi"}]},
        headers=auth,
    ).json()
    assert res == {"reply": "Reminder set for 6pm on 1 February.", "changed_tasks": True, "look_at_screen": None}
    assert client.get("/tasks", headers=auth).json()[0]["remindAt"] == "2030-02-01T12:00:00+00:00"

    second = fake.bodies[1]["contents"]
    assert second[0]["role"] == "user"  # leading assistant turn trimmed
    assert second[-2]["parts"][0]["thoughtSignature"] == "abc"  # model turn echoed verbatim
    assert "Created task" in second[-1]["parts"][0]["functionResponse"]["response"]["result"]
    assert "Call mum" in fake.bodies[1]["system_instruction"]["parts"][0]["text"]  # fresh task list each turn


def test_gemini_tool_loop_hands_screen_questions_to_the_desktop(client, auth, monkeypatch):
    from app import llm

    fake = ScriptedGemini([[{"text": "Let me look."}, {"functionCall": {"name": "look_at_screen", "args": {"goal": "insert a table in Word"}}}]])
    monkeypatch.setattr(llm, "get_provider", lambda: fake)
    res = client.post("/chat", json={"message": "how do I add a table here"}, headers=auth).json()
    assert res["look_at_screen"] == {"goal": "insert a table in Word"}
    assert len(fake.bodies) == 1


def test_gemini_errors_become_502(client, auth, monkeypatch):
    from app import llm

    class Down:
        name, model = "gemini", "down"

        def generate(self, body):
            raise llm.LLMError("Gemini free-tier rate limit reached, please wait a minute and try again")

    monkeypatch.setattr(llm, "get_provider", lambda: Down())
    res = client.post("/chat", json={"message": "add eggs to my list"}, headers=auth)
    assert res.status_code == 502 and "rate limit" in res.json()["error"]
