import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { Db } from '../db';

const HISTORY_LIMIT = 40;
const NOT_CONFIGURED_REPLY =
  "I'm afraid I can't offer much conversation without an ANTHROPIC_API_KEY configured. Add one to your .env file and restart me when you have a moment.";

interface ChatRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
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
      const openTasks = db
        .prepare("SELECT title, due FROM tasks WHERE status = 'active' ORDER BY due ASC LIMIT 10")
        .all() as { title: string; due: string }[];

      const taskContext = openTasks.length
        ? `Open tasks on the user's board, for context (do not recite this list unless asked):\n${openTasks
            .map((task) => `- ${task.title} (due ${task.due})`)
            .join('\n')}`
        : 'The user currently has no open tasks.';

      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system:
          'You are Alfred, a personal AI assistant in the style of Alfred Pennyworth: calm, precise, understated, ' +
          'occasionally dryly witty, never chatty or effusive. Keep replies concise and useful. ' +
          `${taskContext}`,
        messages: history.reverse().map((row) => ({ role: row.role, content: row.content })),
      });

      const textBlock = response.content.find((entry) => entry.type === 'text');
      const reply = textBlock && textBlock.type === 'text' ? textBlock.text : 'I have nothing further to add at this time.';

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
