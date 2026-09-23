import Anthropic from '@anthropic-ai/sdk';
import { captureActiveScreen, checkScreenPermission } from './capture';
import { addTask, listTasks, patchTask, removeTask } from './taskStore';
import type { Task } from '../shared/tasks';
import { trimHistory, type ChatTurn } from '../shared/history';

const MODEL = 'claude-opus-5';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 16_000;

// Each user question runs a short tool loop. Six turns is far more than the
// real flows need (look at screen then answer, or create a task then confirm)
// and exists only so a confused model cannot spin forever on the user's dime.
const MAX_TOOL_TURNS = 6;

// Upper bound on how much conversation travels with a question, enforced here
// rather than trusting the renderer to have sliced it sensibly.
const MAX_HISTORY_TURNS = 8;

export type AskErrorCode = 'no-api-key' | 'permission-denied' | 'api-error';

export class AskError extends Error {
  constructor(
    public code: AskErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type { ChatTurn };

export interface AskOutcome {
  reply: string;
  /** True when Claude actually took a screenshot to answer this question. */
  usedScreen: boolean;
  /** True when this turn created, edited, completed, or deleted a task. */
  changedTasks: boolean;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'look_at_screen',
    description:
      'Take a single screenshot of the display the user is working on and look at it. Call this whenever ' +
      'answering needs you to see what is actually on screen: questions about Word, Excel, PowerPoint, a ' +
      'browser, an error dialog, a game, or anything phrased as "this", "here", or "what I am looking at". ' +
      'Do not call it for questions about the task list, or for general knowledge you already have.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_task',
    description:
      'Add a to-do to the list. Include remind_at only when the user asked to be reminded at a particular ' +
      'time; without it the entry is a plain to-do that raises no notification.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short imperative summary, for example "Call the dentist".' },
        notes: { type: 'string', description: 'Optional extra detail. Omit when the title says everything.' },
        remind_at: {
          type: 'string',
          description:
            'Local wall-clock time as YYYY-MM-DDTHH:MM:SS with no timezone suffix, resolved against the ' +
            'current time given in the system prompt.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description:
      'Change an existing task. Use the exact id from the task list in the system prompt. Pass remind_at as ' +
      'null to drop a reminder while keeping the to-do itself.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        notes: { type: ['string', 'null'] },
        remind_at: { type: ['string', 'null'] },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task done. Use the exact id from the task list in the system prompt.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_task',
    description:
      'Remove a task entirely. Prefer complete_task when the user actually finished it; delete is for ' +
      'entries added by mistake or no longer relevant.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

function formatTaskLine(task: Task): string {
  const parts = [`- id=${task.id} | ${task.title}`];
  if (task.notes) parts.push(`notes: ${task.notes}`);
  if (task.remindAt) parts.push(`reminder: ${new Date(task.remindAt).toLocaleString()}`);
  if (task.done) parts.push('status: done');
  return parts.join(' | ');
}

// The whole task list is injected on every turn instead of sitting behind a
// list_tasks tool. It is small, it is the thing most task questions are about,
// and having the ids up front lets "mark the dentist one done" resolve in a
// single round trip instead of two.
function buildSystemPrompt(tasks: Task[], now: Date): string {
  const open = tasks.filter((task) => !task.done);
  const recentlyDone = tasks.filter((task) => task.done).slice(0, 5);

  const taskSection =
    open.length === 0 && recentlyDone.length === 0
      ? 'The task list is empty.'
      : [
          open.length > 0 ? `Open tasks:\n${open.map(formatTaskLine).join('\n')}` : 'No open tasks.',
          recentlyDone.length > 0 ? `Recently completed:\n${recentlyDone.map(formatTaskLine).join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');

  return [
    'You are Alfred, a floating desktop assistant. You do two things: explain what is on the user’s ' +
      'screen, and keep their to-dos and reminders.',
    '',
    `Current local time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    `Today is ${now.toDateString()}.`,
    '',
    taskSection,
    '',
    'How to answer:',
    '- For anything about what is on screen, call look_at_screen first, then give clear numbered steps ' +
      'grounded in what is actually visible: real menu names, button labels, panel positions. Never ask ' +
      'the user which application they are in, look and see.',
    '- For to-dos and reminders, call the task tools, then confirm in one short sentence, saying the time ' +
      'back in plain words such as "Reminder set for 5pm today". Never invent a time the user did not give. ' +
      'If a request like "remind me later" has no usable time in it, ask for one instead of guessing.',
    '- Resolve relative times such as "tomorrow morning", "in 20 minutes", or "next Tuesday" against the ' +
      'current local time above, and pass them as local wall-clock strings.',
    '- No preamble, no restating the question, no "I would be happy to help". Start at the answer.',
    '- Keep it tight. This renders in a panel about 380 pixels wide.',
  ].join('\n');
}

interface ToolOutcome {
  text: string;
  isError?: boolean;
  image?: { base64: string; mediaType: 'image/png' };
}

async function runTool(name: string, input: Record<string, unknown>, state: AskOutcome): Promise<ToolOutcome> {
  switch (name) {
    case 'look_at_screen': {
      const permission = checkScreenPermission();
      if (permission === 'denied' || permission === 'not-determined') {
        // Thrown rather than returned as a tool error so the renderer can offer
        // the "Open Screen Recording settings" shortcut, instead of Claude
        // paraphrasing a permissions problem it has no way to fix.
        throw new AskError(
          'permission-denied',
          'Alfred needs Screen Recording permission to see what you are looking at.',
        );
      }
      const screenshot = await captureActiveScreen();
      state.usedScreen = true;
      return { text: 'Here is the current screen.', image: screenshot };
    }

    case 'create_task': {
      const title = typeof input.title === 'string' ? input.title : '';
      if (!title.trim()) return { text: 'A task needs a title.', isError: true };
      const task = addTask({
        title,
        notes: typeof input.notes === 'string' ? input.notes : null,
        remindAt: typeof input.remind_at === 'string' ? input.remind_at : null,
      });
      state.changedTasks = true;
      const when = task.remindAt
        ? ` with a reminder at ${new Date(task.remindAt).toLocaleString()}`
        : ' with no reminder';
      return { text: `Created task id=${task.id} "${task.title}"${when}.` };
    }

    case 'update_task': {
      const id = typeof input.id === 'string' ? input.id : '';
      const updated = patchTask(id, {
        title: typeof input.title === 'string' ? input.title : undefined,
        notes: input.notes === null || typeof input.notes === 'string' ? (input.notes as string | null) : undefined,
        remindAt:
          input.remind_at === null || typeof input.remind_at === 'string'
            ? (input.remind_at as string | null)
            : undefined,
      });
      if (!updated) return { text: `No task with id=${id}.`, isError: true };
      state.changedTasks = true;
      return { text: `Updated "${updated.title}".` };
    }

    case 'complete_task': {
      const id = typeof input.id === 'string' ? input.id : '';
      const updated = patchTask(id, { done: true });
      if (!updated) return { text: `No task with id=${id}.`, isError: true };
      state.changedTasks = true;
      return { text: `Marked "${updated.title}" done.` };
    }

    case 'delete_task': {
      const id = typeof input.id === 'string' ? input.id : '';
      if (!removeTask(id)) return { text: `No task with id=${id}.`, isError: true };
      state.changedTasks = true;
      return { text: 'Task deleted.' };
    }

    default:
      return { text: `Unknown tool: ${name}`, isError: true };
  }
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Answers one user question, looping until Claude stops asking for tools.
 *
 * Nothing is captured up front: a screenshot is taken only inside the
 * look_at_screen tool, so asking Alfred to add a to-do never touches the screen
 * at all. When a screenshot is taken it lives in this call's locals and in the
 * outgoing request body, and is gone once the loop returns. It is never written
 * to disk and never handed back to the renderer.
 */
export async function ask(question: string, history: ChatTurn[], apiKey: string): Promise<AskOutcome> {
  const client = new Anthropic({ apiKey });
  const outcome: AskOutcome = { reply: '', usedScreen: false, changedTasks: false };

  const messages: Anthropic.MessageParam[] = [
    ...trimHistory(history, MAX_HISTORY_TURNS).map(
      (turn): Anthropic.MessageParam => ({ role: turn.role, content: turn.content }),
    ),
    { role: 'user', content: question },
  ];

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          // Effort is the latency lever here. Reading a screenshot and setting
          // a reminder are not hard reasoning problems, and a floating panel
          // is supposed to feel instant.
          output_config: { effort: 'low' },
          system: buildSystemPrompt(listTasks(), new Date()),
          tools: TOOLS,
          messages,
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      if (response.stop_reason === 'refusal') {
        throw new AskError('api-error', 'Claude declined to answer that one. Try rephrasing the question.');
      }

      // The full content array goes back verbatim, which keeps thinking blocks
      // intact across the loop; editing or dropping them invalidates the turn.
      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        outcome.reply = textOf(response) || 'Done.';
        return outcome;
      }

      // Every tool_result for this turn goes back in a single user message.
      // Splitting them teaches the model to stop batching its calls.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const result = await runTool(toolUse.name, (toolUse.input ?? {}) as Record<string, unknown>, outcome);

        const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [
          { type: 'text', text: result.text },
        ];
        if (result.image) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: result.image.mediaType, data: result.image.base64 },
          });
        }

        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content,
          ...(result.isError ? { is_error: true } : {}),
        });
      }

      messages.push({ role: 'user', content: results });
    }

    throw new AskError('api-error', 'Alfred got stuck working that out. Try asking a simpler question.');
  } catch (error) {
    if (error instanceof AskError) throw error;
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AskError('api-error', 'That API key was rejected. Double-check it in Settings.');
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AskError('api-error', 'Rate limited by the Claude API. Give it a moment and retry.');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AskError('api-error', 'Could not reach Claude. Check your internet connection.');
    }
    if (error instanceof Anthropic.APIError) {
      throw new AskError('api-error', `Claude API error: ${error.message}`);
    }
    throw new AskError('api-error', (error as Error).message || 'Something went wrong reaching Claude.');
  }
}
