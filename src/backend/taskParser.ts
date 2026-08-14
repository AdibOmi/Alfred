import Anthropic from '@anthropic-ai/sdk';
import type { TaskKind } from './taskActions';

export interface ParsedTask {
  title: string;
  due: string | null; // ISO 8601, or null for an undated item
  kind: TaskKind;
  usedFallback: boolean;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export async function parseTaskText(text: string, anthropicApiKey: string | undefined): Promise<ParsedTask> {
  if (anthropicApiKey) {
    try {
      return await parseWithClaude(text, anthropicApiKey);
    } catch {
      // fall through to the deterministic parser below
    }
  }
  return { ...parseWithHeuristics(text), usedFallback: true };
}

async function parseWithClaude(text: string, apiKey: string): Promise<ParsedTask> {
  const client = new Anthropic({ apiKey });
  const now = new Date();

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system:
      `You convert a short natural-language reminder into strict JSON: ` +
      `{"title": string, "due": string | null, "kind": "deadline" | "todo"}. ` +
      `The current moment is ${now.toISOString()} (local reference time). If the text specifies or implies a date/time, ` +
      `resolve it against that ("tomorrow", "friday", "in 3 days", "21st Aug") into an ISO 8601 datetime for "due", ` +
      `defaulting to 09:00 when only a date is given. If the text does NOT mention or imply any date or time at all, ` +
      `set "due" to null — never invent one. "title" is the task stripped of any date/time phrasing, kept concise. ` +
      `"kind" classifies the task by scope, not by whether it has a date: "todo" is a small, single-sitting, ` +
      `everyday item (an errand, a quick call, a chore) even if it has a specific time attached; "deadline" is a ` +
      `larger task, project, assignment, or goal with real effort behind it, whether or not an exact date is given yet ` +
      `(e.g. "submit thesis draft", "finish reading the DB internals book", "prepare interview answers"). ` +
      `Respond with ONLY the JSON object, no prose.`,
    messages: [{ role: 'user', content: text }],
  });

  const block = message.content.find((entry) => entry.type === 'text');
  if (!block || block.type !== 'text') throw new Error('no text content from model');

  const jsonMatch = block.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('no JSON object in model response');

  const parsed = JSON.parse(jsonMatch[0]);
  if (typeof parsed.title !== 'string' || !(parsed.due === null || typeof parsed.due === 'string')) {
    throw new Error('malformed parse result');
  }

  let due: string | null = null;
  if (typeof parsed.due === 'string') {
    const parsedDue = new Date(parsed.due);
    if (Number.isNaN(parsedDue.getTime())) throw new Error('invalid due date');
    due = parsedDue.toISOString();
  }

  const kind: TaskKind = parsed.kind === 'deadline' || parsed.kind === 'todo' ? parsed.kind : due ? 'deadline' : 'todo';

  return { title: parsed.title.trim() || text, due, kind, usedFallback: false };
}

function parseWithHeuristics(text: string): { title: string; due: string | null; kind: TaskKind } {
  const now = new Date();
  let remaining = text;
  const target = new Date(now);
  target.setHours(9, 0, 0, 0);
  let matchedDay = false;
  let saidToday = false;

  const lower = text.toLowerCase();

  if (/\btoday\b/.test(lower)) {
    matchedDay = true;
    saidToday = true;
    remaining = remaining.replace(/\btoday\b/i, '');
  } else if (/\btomorrow\b/.test(lower)) {
    target.setDate(target.getDate() + 1);
    matchedDay = true;
    remaining = remaining.replace(/\btomorrow\b/i, '');
  } else {
    const inDaysMatch = lower.match(/\bin (\d+) days?\b/);
    if (inDaysMatch) {
      target.setDate(target.getDate() + Number(inDaysMatch[1]));
      matchedDay = true;
      remaining = remaining.replace(inDaysMatch[0], '');
    } else {
      const weekday = WEEKDAYS.find((day) => new RegExp(`\\b${day}\\b`).test(lower));
      if (weekday) {
        const targetDow = WEEKDAYS.indexOf(weekday);
        const diff = (targetDow - target.getDay() + 7) % 7 || 7;
        target.setDate(target.getDate() + diff);
        matchedDay = true;
        remaining = remaining.replace(new RegExp(`\\b${weekday}\\b`, 'i'), '');
      }
    }
  }

  const timeMatch = lower.match(/\b(\d{1,2})(:(\d{2}))?\s?(am|pm)\b/);
  if (timeMatch) {
    let hours = Number(timeMatch[1]) % 12;
    if (timeMatch[4] === 'pm') hours += 12;
    const minutes = timeMatch[3] ? Number(timeMatch[3]) : 0;
    target.setHours(hours, minutes, 0, 0);
    remaining = remaining.replace(timeMatch[0], '');
  }

  const title = remaining
    .replace(/\bat\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Nothing date/time-related recognized at all: leave it a plain to-do, no fabricated date.
  if (!matchedDay && !timeMatch) {
    return { title: title || text, due: null, kind: 'todo' };
  }

  // "today" with a time that's already passed should roll to tomorrow instead of firing immediately.
  if (saidToday && target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  // No model available to judge scope from wording alone, so this fallback keeps the
  // old convention: a resolved date reads as a deadline, dateless stays a to-do.
  return { title: title || text, due: target.toISOString(), kind: 'deadline' };
}
