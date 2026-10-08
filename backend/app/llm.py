"""Alfred's brain: turns (goal, screenshot, progress so far) into the single next step.

Providers:
- GeminiProvider: Google's Gemini vision models over REST (free key from AI Studio, no card).
- GroqProvider:   open models on Groq's free tier (free key, no card). The fastest option.
- MockProvider:   deterministic, offline. Used by the tests and for demos without a key.

Every provider answers with the same normalised JSON, so the rest of the server never needs to
know which one ran.
"""
from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import dataclass, field

import httpx

from . import config

logger = logging.getLogger("alfred.llm")

ACTIONS = {"click", "double_click", "right_click", "type", "keyboard", "scroll", "drag", "look"}

SYSTEM_PROMPT = """You are Alfred, a calm, courteous butler who teaches people to use software.
The user is stuck on their computer. You receive a screenshot of their screen, what they are
trying to do, and the steps they have already completed.

Work out where they are right now and give exactly ONE next step, the smallest action they can
take on the current screen. Locate the on-screen element for that step.

Rules:
- Look at the screenshot carefully. Only point at elements that are actually visible.
- If the element they need is not visible (hidden in a menu, off-screen), point at whatever opens
  or reveals it (a tab, a menu, a scrollbar) and say so.
- Keyboard shortcuts are welcome as a tip, but the step must still be doable with the mouse.
- If the goal is already achieved on screen, set "done" to true and congratulate them briefly.
- If the user is only asking a question about the screen (what an error means, what something
  does) rather than trying to get somewhere, answer it fully in "reply" (numbered steps are fine),
  set "done" to true and box_2d to null.
- "target_label" is the element's visible text copied exactly as it appears on screen, e.g.
  "Insert" or "Page Number", with no extra words such as "tab", "button" or "menu". Alfred finds
  that text on screen to place the pointer precisely. For an icon with no text, describe the icon.
- Keep "instruction" under 25 words, imperative, plain English. No jargon without explaining it.
- "reply" is one or two warm sentences in a butler's voice ("Very good, sir/madam" is fine, but
  do not overdo it). Explain WHY the step matters so they learn, not just what to click.

Return ONLY JSON in this exact shape:
{
  "app": "name of the application in focus, e.g. Microsoft Excel",
  "reply": "short friendly explanation",
  "step": {
    "instruction": "what to do now",
    "target_label": "visible text or name of the element, e.g. 'Insert tab'",
    "action": "click | double_click | right_click | type | keyboard | scroll | drag | look",
    "box_2d": [ymin, xmin, ymax, xmax]
  },
  "steps_remaining": 3,
  "done": false
}
box_2d is the bounding box of the target element, normalised to 0-1000 on both axes of the
screenshot. Use null for box_2d only when there is genuinely nothing to point at.
"""


class LLMError(RuntimeError):
    pass


# One pooled client for every provider: reusing the TLS connection saves a handshake (often
# 100-300 ms) on every call after the first, which is most of the overhead of a fast model.
_http = httpx.Client(timeout=config.LLM_TIMEOUT_SECONDS, limits=httpx.Limits(max_keepalive_connections=8))


@dataclass
class StepRequest:
    goal: str
    screenshot_jpeg: bytes
    completed_steps: list[str] = field(default_factory=list)
    user_message: str | None = None


def build_user_prompt(req: StepRequest) -> str:
    lines = [f"GOAL: {req.goal}"]
    if req.completed_steps:
        lines.append("STEPS ALREADY DONE:")
        lines += [f"{i}. {s}" for i, s in enumerate(req.completed_steps, 1)]
    else:
        lines.append("STEPS ALREADY DONE: none yet, this is the first step.")
    if req.user_message:
        lines.append(f"THE USER JUST SAID: {req.user_message}")
    lines.append("What is the single next step on the screen shown?")
    return "\n".join(lines)


def _clamp(value: object) -> int:
    return max(0, min(1000, int(round(float(value)))))  # type: ignore[arg-type]


def normalise(raw: dict) -> dict:
    """Validate the model's JSON so the client can trust every field."""
    step = raw.get("step") or {}
    box = step.get("box_2d")
    clean_box = None
    if isinstance(box, (list, tuple)) and len(box) == 4:
        try:
            ymin, xmin, ymax, xmax = (_clamp(v) for v in box)
            if ymax < ymin:
                ymin, ymax = ymax, ymin
            if xmax < xmin:
                xmin, xmax = xmax, xmin
            if ymax - ymin >= 2 and xmax - xmin >= 2:
                clean_box = [ymin, xmin, ymax, xmax]
        except (TypeError, ValueError):
            clean_box = None

    action = str(step.get("action") or "click").lower().replace(" ", "_")
    done = bool(raw.get("done"))
    instruction = str(step.get("instruction") or "").strip()
    if not instruction:
        instruction = "You're all set." if done else "Take a look at the highlighted area."
    try:
        remaining = max(0, int(raw.get("steps_remaining", 0)))
    except (TypeError, ValueError):
        remaining = 0

    return {
        "app": str(raw.get("app") or "Unknown app").strip()[:80],
        "reply": str(raw.get("reply") or "").strip()[:600],
        "step": {
            "instruction": instruction[:300],
            "target_label": str(step.get("target_label") or "").strip()[:120] or None,
            "action": action if action in ACTIONS else "click",
            "box_2d": clean_box,
        },
        "steps_remaining": remaining,
        "done": done,
    }


def parse_json(text: str) -> dict:
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _thinking_off(model: str) -> dict:
    """Thinking is the biggest latency cost on Flash models, and pointing at a button doesn't need it."""
    if model.startswith("gemini-2"):
        return {"thinkingBudget": 0}
    return {"thinkingLevel": "minimal"}


class GeminiProvider:
    name = "gemini"
    endpoint = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    max_width = config.SCREENSHOT_MAX_WIDTH
    # Gemini is trained to return box_2d, so its boxes are good enough to point with on their own.
    trusted_boxes = True

    def __init__(self, api_key: str, models: list[str]):
        if not api_key:
            raise LLMError("GEMINI_API_KEY is not set")
        self.api_key = api_key
        self.models = models
        self.model = models[0]
        # Models that rejected the thinking switch; they are called without it from then on.
        self.no_thinking_config: set[str] = set()

    def next_step(self, req: StepRequest) -> dict:
        body = {
            "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(req.screenshot_jpeg).decode()}},
                        {"text": build_user_prompt(req)},
                    ],
                }
            ],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
        }
        data = self.generate(body)
        try:
            parts = data["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            return normalise(parse_json(text))
        except (KeyError, IndexError, ValueError) as error:
            logger.warning("Unparseable Gemini response: %s", str(data)[:500])
            raise LLMError("Alfred could not understand the model's answer, please try again") from error

    def generate(self, body: dict) -> dict:
        """POST a generateContent body, falling back through GEMINI_MODEL until one model answers."""
        last_error = "no model configured"
        for model in [self.model] + [m for m in self.models if m != self.model]:
            response = self._post(model, body)
            if response.status_code == 400 and "thinking" in response.text.lower() and model not in self.no_thinking_config:
                self.no_thinking_config.add(model)
                response = self._post(model, body)

            if response.status_code == 404:  # model retired or not available to this key: try the next one
                last_error = f"model {model} not found"
                continue
            if response.status_code == 429:
                raise LLMError("Gemini free-tier rate limit reached, please wait a minute and try again")
            if response.status_code in (400, 401, 403) and "API_KEY" in response.text.upper():
                raise LLMError("The server's GEMINI_API_KEY was rejected. Check backend/.env")
            if response.status_code >= 400:
                raise LLMError(f"Gemini error {response.status_code}: {response.text[:300]}")
            self.model = model
            return response.json()
        raise LLMError(f"No usable Gemini model ({last_error}). Set GEMINI_MODEL in .env")

    def _post(self, model: str, body: dict) -> httpx.Response:
        generation = dict(body.get("generationConfig") or {})
        if model not in self.no_thinking_config:
            generation["thinkingConfig"] = _thinking_off(model)
        try:
            return _http.post(
                self.endpoint.format(model=model),
                headers={"x-goog-api-key": self.api_key},
                json={**body, "generationConfig": generation},
            )
        except httpx.HTTPError as error:
            raise LLMError(f"Could not reach Gemini: {error}") from error


class GroqProvider:
    """Groq's OpenAI-compatible API: a vision model for steps, a text model for the chat loop.

    Answers come back in well under a second, which is what makes Alfred feel instant. Open
    vision models name the right element reliably but place boxes loosely, so the desktop app
    snaps the pointer to the element's text on screen (see src/shared/snap.ts) and drops a box
    it can't confirm rather than pointing at the wrong thing.
    """

    name = "groq"
    dialect = "openai"
    endpoint = "https://api.groq.com/openai/v1/chat/completions"
    # The free tier meters input tokens per minute; a smaller screenshot leaves room for more
    # steps and still keeps menu labels legible.
    max_width = 1280
    trusted_boxes = False

    def __init__(self, api_key: str, vision_model: str, chat_model: str):
        if not api_key:
            raise LLMError("GROQ_API_KEY is not set")
        self.api_key = api_key
        self.model = vision_model
        self.chat_model = chat_model

    def next_step(self, req: StepRequest) -> dict:
        image = "data:image/jpeg;base64," + base64.b64encode(req.screenshot_jpeg).decode()
        data = self.complete({
            "model": self.model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": image}},
                    {"type": "text", "text": build_user_prompt(req)},
                ]},
            ],
        })
        try:
            return normalise(parse_json(data["choices"][0]["message"]["content"] or ""))
        except (KeyError, IndexError, ValueError) as error:
            logger.warning("Unparseable Groq response: %s", str(data)[:500])
            raise LLMError("Alfred could not understand the model's answer, please try again") from error

    def complete(self, body: dict) -> dict:
        """POST a chat completion. A short rate-limit wait is absorbed here rather than failing the request."""
        for attempt in range(2):
            try:
                response = _http.post(self.endpoint, headers={"Authorization": f"Bearer {self.api_key}"}, json=body)
            except httpx.HTTPError as error:
                raise LLMError(f"Could not reach Groq: {error}") from error
            if response.status_code == 429:
                wait = _retry_after(response)
                if attempt == 0 and wait is not None and wait <= 8:
                    time.sleep(wait + 0.2)
                    continue
                raise LLMError("Groq free-tier rate limit reached, please wait a few seconds and try again")
            if response.status_code == 401:
                raise LLMError("The server's GROQ_API_KEY was rejected. Check your .env")
            if response.status_code >= 400:
                raise LLMError(f"Groq error {response.status_code}: {response.text[:300]}")
            return response.json()
        raise LLMError("Groq free-tier rate limit reached, please wait a few seconds and try again")


def _retry_after(response: httpx.Response) -> float | None:
    header = response.headers.get("retry-after")
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    match = re.search(r"try again in ([\d.]+)(ms|s)", response.text)
    if match:
        return float(match[1]) / (1000 if match[2] == "ms" else 1)
    return None


class MockProvider:
    """Offline stand-in that walks through a fixed three-step script."""

    name = "mock"
    model = "mock-butler-1"
    max_width = config.SCREENSHOT_MAX_WIDTH
    trusted_boxes = True

    SCRIPT = [
        ("Click the menu or ribbon tab that contains this feature.", "Menu bar", [20, 0, 80, 400]),
        ("Click the button for the feature you need.", "Feature button", [80, 300, 160, 500]),
        ("Fill in the options and press OK to finish.", "OK button", [600, 600, 660, 720]),
    ]

    def next_step(self, req: StepRequest) -> dict:
        index = len(req.completed_steps)
        if index >= len(self.SCRIPT):
            return normalise({
                "app": "Demo app",
                "reply": "Splendid. That should do it. You've completed the task.",
                "step": {"instruction": "You're all set.", "action": "look", "box_2d": None},
                "steps_remaining": 0,
                "done": True,
            })
        instruction, label, box = self.SCRIPT[index]
        return normalise({
            "app": "Demo app",
            "reply": "Certainly. Let us take it one step at a time. (Demo mode: set GEMINI_API_KEY for real guidance.)",
            "step": {"instruction": instruction, "target_label": label, "action": "click", "box_2d": box},
            "steps_remaining": len(self.SCRIPT) - index - 1,
            "done": False,
        })


Provider = GeminiProvider | GroqProvider | MockProvider
_provider: Provider | None = None


def get_provider() -> Provider:
    global _provider
    if _provider is None:
        if config.LLM_PROVIDER == "gemini":
            _provider = GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODELS)
        elif config.LLM_PROVIDER == "groq":
            _provider = GroqProvider(config.GROQ_API_KEY, config.GROQ_VISION_MODEL, config.GROQ_CHAT_MODEL)
        else:
            _provider = MockProvider()
    return _provider
