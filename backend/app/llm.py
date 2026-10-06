"""Alfred's brain: turns (goal, screenshot, progress so far) into the single next step.

Providers:
- GeminiProvider: Google's Gemini vision models over REST (free key from AI Studio, no card).
- MockProvider:   deterministic, offline. Used by the tests and for demos without a key.
"""
from __future__ import annotations

import base64
import json
import logging
import re
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


class GeminiProvider:
    name = "gemini"
    endpoint = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def __init__(self, api_key: str, models: list[str]):
        if not api_key:
            raise LLMError("GEMINI_API_KEY is not set")
        self.api_key = api_key
        self.models = models
        self.model = models[0]

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
            try:
                response = httpx.post(
                    self.endpoint.format(model=model),
                    headers={"x-goog-api-key": self.api_key},
                    json=body,
                    timeout=config.LLM_TIMEOUT_SECONDS,
                )
            except httpx.HTTPError as error:
                raise LLMError(f"Could not reach Gemini: {error}") from error

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


class MockProvider:
    """Offline stand-in that walks through a fixed three-step script."""

    name = "mock"
    model = "mock-butler-1"

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


_provider: GeminiProvider | MockProvider | None = None


def get_provider() -> GeminiProvider | MockProvider:
    global _provider
    if _provider is None:
        if config.LLM_PROVIDER == "gemini":
            _provider = GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODELS)
        else:
            _provider = MockProvider()
    return _provider
