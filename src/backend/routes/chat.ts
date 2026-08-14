import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { Db } from '../db';
import { createTask, listActiveTasks, completeTaskByQuery, deleteTaskByQuery } from '../taskActions';

const HISTORY_LIMIT = 40;
const MAX_TOOL_ITERATIONS = 4;
const NOT_CONFIGURED_REPLY =
  "I'm afraid I can't offer much conversation without an ANTHROPIC_API_KEY configured. Add one to your .env file and restart me when you have a moment.";

interface ChatRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description:
      'Create a new reminder with a title and an optional due date. If the user specifies or implies a date/time ' +
      '("tomorrow", "friday", "21st Aug"), resolve it against the current moment given in the system prompt and pass it ' +
      'as "due" (default to 09:00 local time if no time of day is given). If the user does NOT mention any date or time, ' +
      'omit "due" entirely. Never invent a date that wasn\'t implied. Also classify "kind": "todo" for a small, ' +
      'single-sitting, everyday item (an errand, a quick call, a chore) even if it has a specific time attached; ' +
      '"deadline" for a larger task, project, assignment, or goal with real effort behind it, whether or not an exact ' +
      'date is given yet. Omit "kind" only if you genuinely cannot tell — it then falls back to date-based guessing.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title, stripped of date/time phrasing' },
        due: { type: 'string', description: 'ISO 8601 due datetime — omit if no date/time was mentioned or implied' },
        kind: { type: 'string', enum: ['deadline', 'todo'], description: 'Scope classification — see description above' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List the user\'s current open (not done) reminders/tasks, soonest due first.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'complete_task',
    description: 'Mark a reminder/task as done. Matched by id, or by exact/partial (case-insensitive) title.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Task id, or a title or substring of one' } },
      required: ['query'],
    },
  },
  {
    name: 'delete_task',
    description: 'Permanently remove a reminder/task. Matched by id, or by exact/partial (case-insensitive) title.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Task id, or a title or substring of one' } },
      required: ['query'],
    },
  },
];

function runTool(db: Db, name: string, input: unknown): { content: string; isError: boolean } {
  const args = (input ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'create_task': {
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        if (!title) {
          return { content: JSON.stringify({ error: 'title is required' }), isError: true };
        }
        let due: string | null = null;
        if (typeof args.due === 'string' && args.due.trim()) {
          const parsedDue = new Date(args.due);
          if (Number.isNaN(parsedDue.getTime())) {
            return { content: JSON.stringify({ error: 'due must be a valid ISO datetime if provided' }), isError: true };
          }
          due = parsedDue.toISOString();
        }
        const kind = args.kind === 'deadline' || args.kind === 'todo' ? args.kind : undefined;
        const task = createTask(db, { title, due, kind });
        return { content: JSON.stringify({ task }), isError: false };
      }
      case 'list_tasks': {
        return { content: JSON.stringify({ tasks: listActiveTasks(db) }), isError: false };
      }
      case 'complete_task': {
        const query = typeof args.query === 'string' ? args.query : '';
        const task = query ? completeTaskByQuery(db, query) : undefined;
        if (!task) return { content: JSON.stringify({ error: 'no matching open task found' }), isError: true };
        return { content: JSON.stringify({ task }), isError: false };
      }
      case 'delete_task': {
        const query = typeof args.query === 'string' ? args.query : '';
        const task = query ? deleteTaskByQuery(db, query) : undefined;
        if (!task) return { content: JSON.stringify({ error: 'no matching task found' }), isError: true };
        return { content: JSON.stringify({ deleted: task }), isError: false };
      }
      default:
        return { content: JSON.stringify({ error: `unknown tool ${name}` }), isError: true };
    }
  } catch (error) {
    return { content: JSON.stringify({ error: (error as Error).message }), isError: true };
  }
}

async function runChatTurn(client: Anthropic, db: Db, history: Pick<ChatRow, 'role' | 'content'>[]): Promise<string> {
  const now = new Date();
  const system =
    'You are Alfred, a personal AI assistant in the style of Alfred Pennyworth: calm, precise, understated, ' +
    'occasionally dryly witty, never chatty or effusive. Keep replies concise and useful. ' +
    `The current moment is ${now.toISOString()} (local reference time) — use it to resolve relative dates. ` +
    'You can create, list, complete, and delete the user\'s reminders/tasks directly with the provided tools ' +
    'when they ask you to — do not just describe what you would do, actually call the tool. A task only needs a due ' +
    'date if the user mentioned or implied one. Classify each new task as a "deadline" (a larger task, project, or ' +
    'goal) or a "todo" (a small everyday item) based on its scope, not on whether it has a date. Confirm briefly ' +
    'once a tool call succeeds, mentioning the resolved date if there is one.';

  let messages: Anthropic.MessageParam[] = history.map((row) => ({ role: row.role, content: row.content }));

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((entry) => entry.type === 'text');
      return textBlock && textBlock.type === 'text' ? textBlock.text : 'I have nothing further to add at this time.';
    }

    messages = [...messages, { role: 'assistant', content: response.content }];

    const toolResults: Anthropic.ToolResultBlockParam[] = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => {
        const result = runTool(db, block.name, block.input);
        return { type: 'tool_result', tool_use_id: block.id, content: result.content, is_error: result.isError };
      });
    messages = [...messages, { role: 'user', content: toolResults }];
  }

  return "That's taking more steps than I'd like — could you rephrase the request?";
}

export function chatRouter(db: Db, anthropicApiKey: string | undefined) {
  const router = Router();
  const client = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null;

  router.get('/', (_req, res) => {
    const rows = db
      .prepare('SELECT id, role, content, created_at FROM chat_messages ORDER BY id DESC LIMIT ?')
      .all(HISTORY_LIMIT) as ChatRow[];
    res.json({ messages: rows.reverse() });
  });

  router.post('/', async (req, res) => {
    const { message } = req.body ?? {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const now = new Date().toISOString();
    db.prepare('INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)').run('user', message.trim(), now);

    if (!client) {
      db.prepare('INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)').run(
        'assistant',
        NOT_CONFIGURED_REPLY,
        new Date().toISOString(),
      );
      return res.json({ reply: NOT_CONFIGURED_REPLY, configured: false });
    }

    try {
      const history = db
        .prepare('SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT ?')
        .all(HISTORY_LIMIT) as Pick<ChatRow, 'role' | 'content'>[];

      const reply = await runChatTurn(client, db, history.reverse());

      db.prepare('INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)').run(
        'assistant',
        reply,
        new Date().toISOString(),
      );
      res.json({ reply, configured: true });
    } catch (error) {
      const reply = `I ran into a problem reaching Claude: ${(error as Error).message}`;
      db.prepare('INSERT INTO chat_messages (role, content, created_at) VALUES (?, ?, ?)').run(
        'assistant',
        reply,
        new Date().toISOString(),
      );
      res.status(502).json({ reply, configured: true, error: true });
    }
  });

  return router;
}
