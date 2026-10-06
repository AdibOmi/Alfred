from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    weekly_report: bool
    created_at: str


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    weekly_report: bool | None = None


class StartSessionRequest(BaseModel):
    goal: str = Field(min_length=3, max_length=500, description="Where the user is stuck / what they want to do")
    screenshot: str = Field(min_length=100, description="Base64 PNG/JPEG of the user's screen (data: URL allowed)")


class NextStepRequest(BaseModel):
    screenshot: str = Field(min_length=100)
    message: str | None = Field(default=None, max_length=500, description="Optional follow-up, e.g. 'I can't find it'")
    completed: bool = Field(default=True, description="Did the user finish the previous step?")


class StepOut(BaseModel):
    id: int | None
    position: int
    instruction: str
    target_label: str | None
    action: str
    box_2d: list[int] | None = Field(description="[ymin, xmin, ymax, xmax] normalised 0-1000 on the screenshot")


class AssistResponse(BaseModel):
    session_id: int
    status: Literal["active", "solved", "abandoned"]
    app: str
    reply: str
    step: StepOut
    steps_remaining: int
    done: bool
    from_cache: bool
    provider: str


class MessageOut(BaseModel):
    role: str
    content: str
    created_at: str


class SessionSummary(BaseModel):
    id: int
    goal: str
    app_name: str | None
    status: str
    step_count: int
    created_at: str
    updated_at: str


class SessionDetail(SessionSummary):
    steps: list[StepOut]
    messages: list[MessageOut]


class StatusUpdate(BaseModel):
    status: Literal["solved", "abandoned"]


class ErrorResponse(BaseModel):
    error: str


TokenResponse.model_rebuild()


# ---------------------------------------------------------------- tasks & chat
# Task JSON keeps the desktop app's camelCase names (src/shared/tasks.ts).

class TaskOut(BaseModel):
    id: str
    title: str
    notes: str | None
    done: bool
    createdAt: str
    completedAt: str | None
    remindAt: str | None
    remindedAt: str | None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)
    remindAt: str | None = Field(default=None, description="ISO-8601; a value with no zone is read as UTC")


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)
    remindAt: str | None = None
    done: bool | None = None
    reminded: bool | None = Field(default=None, description="Set by the desktop app after it shows the notification")


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    client_time: str | None = Field(default=None, description="The user's local time with offset, e.g. 2026-10-07T15:20:00+06:00")


class LookAtScreen(BaseModel):
    goal: str


class ChatResponse(BaseModel):
    reply: str
    changed_tasks: bool
    look_at_screen: LookAtScreen | None = Field(description="Set when the desktop should screenshot and start a guided session")
