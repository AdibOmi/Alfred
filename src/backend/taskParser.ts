import Anthropic from '@anthropic-ai/sdk';

export interface ParsedTask {
  title: string;
  due: string; // ISO 8601
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
      `You convert a short natural-language reminder into strict JSON: {"title": string, "due": string}. ` +
      `"due" must be an ISO 8601 datetime. The current moment is ${now.toISOString()} (local reference time). ` +
      `Resolve relative dates ("tomorrow", "friday", "in 3 days") against that. If no time of day is given, default to 09:00. ` +
      `"title" is the task stripped of date/time phrasing, kept concise. Respond with ONLY the JSON object, no prose.`,
    messages: [{ role: 'user', content: text }],
  });

  const block = message.content.find((entry) => entry.type === 'text');
  if (!block || block.type !== 'text') throw new Error('no text content from model');

  const jsonMatch = block.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('no JSON object in model response');

  const parsed = JSON.parse(jsonMatch[0]);
  if (typeof parsed.title !== 'string' || typeof parsed.due !== 'string') {
    throw new Error('malformed parse result');
  }
  const due = new Date(parsed.due);
  if (Number.isNaN(due.getTime())) throw new Error('invalid due date');

  return { title: parsed.title.trim() || text, due: due.toISOString(), usedFallback: false };
}

function parseWithHeuristics(text: string): { title: string; due: string } {
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
  } else if (!matchedDay) {
    // Nothing recognized at all: default to tomorrow morning rather than "right now".
    target.setDate(target.getDate() + 1);
  }

  // "today" with a time that's already passed should roll to tomorrow instead of firing immediately.
  if (saidToday && target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  const title = remaining
    .replace(/\bat\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { title: title || text, due: target.toISOString() };
}
