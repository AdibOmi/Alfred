import Anthropic from '@anthropic-ai/sdk';
import { captureActiveScreen } from './capture';

const VISION_MODEL = 'claude-sonnet-5';
const REQUEST_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT =
  'You are Alfred, a patient, step-by-step on-screen guide. You are shown a single screenshot of ' +
  "whatever the user is currently looking at — Word, Excel, a browser, a game, anything — plus the user's " +
  'question about it. Identify the relevant application or context from the screenshot yourself; never ask ' +
  'the user to tell you what app they are using. Answer with clear, numbered steps grounded in what is ' +
  'actually visible (menu names, button labels, panel positions). No preamble, no restating the question, ' +
  "no filler like \"I'd be happy to help\" — start directly at step 1. If the screenshot doesn't show enough " +
  'to answer confidently, say so briefly and ask exactly what you need.';

export type AskErrorCode = 'no-api-key' | 'permission-denied' | 'api-error';

export class AskError extends Error {
  constructor(
    public code: AskErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// Captures the active screen and asks Claude about it in one shot. The image
// buffer lives only in this function's stack — it is never written to disk,
// returned to the renderer, or kept around after the request resolves.
export async function askAboutScreen(question: string, apiKey: string): Promise<string> {
  const screenshot = await captureActiveScreen();
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create(
      {
        model: VISION_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: screenshot.mediaType, data: screenshot.base64 },
              },
              { type: 'text', text: question },
            ],
          },
        ],
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    const block = response.content.find((entry) => entry.type === 'text');
    return block && block.type === 'text' ? block.text : 'I have nothing further to add.';
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AskError('api-error', 'That API key was rejected — double-check it in Settings.');
    }
    if (error instanceof Anthropic.APIError) {
      throw new AskError('api-error', `Claude API error: ${error.message}`);
    }
    throw new AskError('api-error', (error as Error).message || 'Something went wrong reaching Claude.');
  }
}
