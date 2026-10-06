from app import cache, jobs
from app.imaging import decode_screenshot
from app.llm import normalise, parse_json

from conftest import make_screenshot


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["llm_provider"] == "mock"


def test_signup_login_and_me(client):
    payload = {"name": "Bruce", "email": "bruce@wayne.com", "password": "iambatman"}
    assert client.post("/auth/signup", json=payload).status_code == 201
    assert client.post("/auth/signup", json=payload).status_code == 400  # duplicate

    bad = client.post("/auth/login", json={"email": payload["email"], "password": "wrong"})
    assert bad.status_code == 401
    assert bad.json() == {"error": "Invalid email or password"}

    token = client.post("/auth/login", json={"email": payload["email"], "password": "iambatman"}).json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["name"] == "Bruce" and me["weekly_report"] is True


def test_protected_routes_need_token(client):
    assert client.get("/sessions").status_code == 401
    assert client.get("/sessions", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_validation_errors_are_400(client, auth):
    response = client.post("/sessions", json={"goal": "hi"}, headers=auth)
    assert response.status_code == 400
    assert "screenshot" in response.json()["error"]

    response = client.post("/sessions", json={"goal": "make a chart", "screenshot": "x" * 200}, headers=auth)
    assert response.status_code == 400


def test_full_guided_session(client, auth):
    start = client.post("/sessions", json={"goal": "Insert a pie chart in Excel", "screenshot": make_screenshot(0)}, headers=auth)
    assert start.status_code == 201, start.text
    first = start.json()
    assert first["status"] == "active" and first["step"]["position"] == 1
    assert len(first["step"]["box_2d"]) == 4
    session_id = first["session_id"]

    positions = []
    for _ in range(3):
        nxt = client.post(f"/sessions/{session_id}/next", json={"screenshot": make_screenshot(1)}, headers=auth).json()
        positions.append(nxt["step"]["position"])
    assert nxt["done"] is True and nxt["status"] == "solved"
    assert positions == [2, 3, 4]

    detail = client.get(f"/sessions/{session_id}", headers=auth).json()
    assert detail["status"] == "solved"
    assert [s["position"] for s in detail["steps"]] == [1, 2, 3]
    assert detail["messages"][0] == {**detail["messages"][0], "role": "user", "content": "Insert a pie chart in Excel"}

    listing = client.get("/sessions", headers=auth).json()
    assert listing[0]["id"] == session_id and listing[0]["step_count"] == 3


def test_follow_up_without_completing(client, auth):
    sid = client.post("/sessions", json={"goal": "Add a page number in Word", "screenshot": make_screenshot(0)}, headers=auth).json()["session_id"]
    res = client.post(
        f"/sessions/{sid}/next",
        json={"screenshot": make_screenshot(0), "completed": False, "message": "I can't find that button"},
        headers=auth,
    ).json()
    # Nothing completed, so Alfred re-explains step 1 rather than moving on.
    assert res["step"]["instruction"] == client.get(f"/sessions/{sid}", headers=auth).json()["steps"][0]["instruction"]


def test_same_screen_same_question_hits_cache(client, auth):
    body = {"goal": "Freeze the top row", "screenshot": make_screenshot(0)}
    first = client.post("/sessions", json=body, headers=auth).json()
    cache.clear_memory()  # force the persistent SQLite layer
    second = client.post("/sessions", json=body, headers=auth).json()
    third = client.post("/sessions", json=body, headers=auth).json()
    assert (first["from_cache"], second["from_cache"], third["from_cache"]) == (False, True, True)


def test_users_cannot_see_each_others_sessions(client, auth):
    other = client.post("/auth/signup", json={"name": "Joker", "email": "joker@example.com", "password": "whysoserious"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    sid = client.post("/sessions", json={"goal": "Print a document", "screenshot": make_screenshot(0)}, headers=auth).json()["session_id"]
    assert client.get(f"/sessions/{sid}", headers=other_headers).status_code == 404
    assert client.post(f"/sessions/{sid}/next", json={"screenshot": make_screenshot(0)}, headers=other_headers).status_code == 404


def test_mark_solved_and_stats(client, auth):
    sid = client.post("/sessions", json={"goal": "Bold a word", "screenshot": make_screenshot(1)}, headers=auth).json()["session_id"]
    assert client.patch(f"/sessions/{sid}", json={"status": "solved"}, headers=auth).json()["status"] == "solved"
    stats = client.get("/stats", headers=auth).json()
    assert stats["sessions"] == 1 and stats["solved"] == 1 and stats["steps"] == 1


def test_weekly_pdf_report(client, auth):
    client.post("/sessions", json={"goal": "Merge cells — in Excel", "screenshot": make_screenshot(0)}, headers=auth)
    response = client.get("/reports/weekly.pdf", headers=auth)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


def test_email_report_is_queued_in_background(client, auth):
    body = client.post("/reports/email", json={}, headers=auth).json()
    assert body["queued"] is True and body["email_enabled"] is False


def test_jobs_run_and_are_logged(client, auth):
    client.post("/sessions", json={"goal": "Sort a column", "screenshot": make_screenshot(0)}, headers=auth)
    assert "report(s) built" in jobs.weekly_reports()
    assert "cache entries removed" in jobs.purge_cache()
    assert "stale session" in jobs.close_stale_sessions()
    runs = client.get("/jobs", headers=auth).json()["recent_runs"]
    assert {r["job_name"] for r in runs} >= {"weekly_reports", "purge_cache", "close_stale_sessions"}
    # Regular users cannot trigger jobs by hand.
    assert client.post("/jobs/purge_cache/run", headers=auth).status_code == 403


def test_admin_can_run_job(client):
    token = client.post("/auth/signup", json={"name": "Admin", "email": "admin@example.com", "password": "password123"}).json()["access_token"]
    res = client.post("/jobs/close_stale_sessions/run", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200 and res.json()["job"] == "close_stale_sessions"


def test_perceptual_hash_ignores_tiny_changes():
    a = decode_screenshot(make_screenshot(0))
    b = decode_screenshot(make_screenshot(0))
    c = decode_screenshot(make_screenshot(1))
    assert a.phash == b.phash != c.phash


def test_normalise_cleans_model_output():
    raw = parse_json('```json\n{"app": "Excel", "step": {"instruction": "Click Insert", "action": "Click", "box_2d": [120, 1200, 80, -5]}}\n```')
    clean = normalise(raw)
    assert clean["step"]["box_2d"] == [80, 0, 120, 1000]
    assert clean["step"]["action"] == "click"
    assert clean["done"] is False
