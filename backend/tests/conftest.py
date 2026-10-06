import base64
import io
import os
import sys
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp(prefix="alfred-tests-"))
os.environ.update({
    "DATABASE_PATH": str(_tmp / "test.db"),
    "REPORTS_DIR": str(_tmp / "reports"),
    "LLM_PROVIDER": "mock",
    "SCHEDULER_ENABLED": "false",
    "ADMIN_EMAILS": "admin@example.com",
    "SMTP_HOST": "",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from app.main import app  # noqa: E402


def make_screenshot(variant: int = 0) -> str:
    image = Image.new("RGB", (1280, 720), (240, 240, 240))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1280, 60), fill=(30, 110, 60) if variant == 0 else (40, 70, 160))
    draw.rectangle((100 + variant * 200, 200, 500 + variant * 200, 400), fill=(255, 255, 255), outline=(0, 0, 0))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth(client):
    """Signs up a fresh user and returns auth headers."""
    import uuid

    email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    response = client.post("/auth/signup", json={"name": "Test User", "email": email, "password": "password123"})
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
