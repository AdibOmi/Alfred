import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { AssistResponse, ChatTurn } from '../../electron/preload';
import { BridgeError, call } from '../bridge';
import { isClearlyAboutScreen } from '../../shared/route';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Set on assistant replies that were answered by looking at the screen. */
  usedScreen?: boolean;
  /** Set when the answer came straight from the server's cache. */
  cached?: boolean;
}

interface AskErrorState {
  code: 'permission-denied' | 'api-error';
  message: string;
  retry: () => void;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  guide: AssistResponse | null;
  setGuide: (step: AssistResponse | null) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  onSignedOut: () => void;
}

// How many previous turns travel with each question. Enough for "remind me at
// 5pm" -> "about what?" -> "the dentist" to resolve, without letting a long
// session quietly inflate every request.
const HISTORY_TURNS = 8;

const ACTION_WORDS: Record<string, string> = {
  click: 'Click',
  double_click: 'Double-click',
  right_click: 'Right-click',
  type: 'Type',
  keyboard: 'Keyboard',
  scroll: 'Scroll',
  drag: 'Drag',
  look: 'Look',
};

let nextId = 1;

export function ChatPanel({ messages, setMessages, guide, setGuide, onOpenSettings, onClose, onSignedOut }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<AskErrorState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, error, sending, guide]);

  const lastQuestion = [...messages].reverse().find((entry) => entry.role === 'user')?.content ?? '';
  const status = guide
    ? 'Taking a fresh look…'
    : isClearlyAboutScreen(lastQuestion)
      ? 'Looking at your screen…'
      : 'Thinking…';

  const say = (entry: Omit<ChatMessage, 'id'>) => setMessages((prev) => [...prev, { ...entry, id: nextId++ }]);

  // Every request goes through here so failures are reported the same way.
  const run = async (work: () => Promise<void>, retry: () => void) => {
    setError(null);
    setSending(true);
    try {
      await work();
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'signed-out') {
        onSignedOut();
        return;
      }
      const code = err instanceof BridgeError && err.code === 'permission-denied' ? 'permission-denied' : 'api-error';
      setError({ code, message: (err as Error).message, retry });
    } finally {
      setSending(false);
    }
  };

  const showStep = (step: AssistResponse) => {
    say({ role: 'assistant', content: step.reply || step.step.instruction, usedScreen: true, cached: step.from_cache });
    setGuide(step.done ? null : step);
  };

  // A follow-up typed during a guided session goes to that session, without moving on.
  const ask = (question: string, prior: ChatMessage[]) =>
    run(
      async () => {
        if (guide) {
          showStep(await call(window.alfred.guideNext(question, false)));
          return;
        }
        const history: ChatTurn[] = prior.slice(-HISTORY_TURNS).map(({ role, content }) => ({ role, content }));
        const outcome = await call(window.alfred.ask(question, history));
        if (outcome.guide) showStep(outcome.guide);
        else say({ role: 'assistant', content: outcome.reply });
      },
      () => ask(question, prior),
    );

  const next = (message: string | null, completed: boolean) =>
    run(
      async () => {
        if (message) say({ role: 'user', content: message });
        showStep(await call(window.alfred.guideNext(message, completed)));
      },
      () => next(null, completed),
    );

  const finish = () =>
    run(
      async () => {
        await call(window.alfred.guideFinish('solved'));
        setGuide(null);
        say({ role: 'assistant', content: 'Splendid. Glad I could help. I shall be right here if you need me.' });
      },
      finish,
    );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput('');

    // The history sent with the request is everything before this question, so
    // it is captured here rather than read back out of state after the append.
    const prior = messages;
    say({ role: 'user', content: text });
    ask(text, prior);
  };

  return (
    <div className="chat-panel">
      <div className="panel-header-row">
        <h2>Ask Alfred</h2>
        <div className="panel-header-actions">
          <button className="icon-button" onClick={onOpenSettings} aria-label="Settings">
            ⚙
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="chat-window" ref={listRef}>
        {messages.length === 0 && !error && (
          <div className="chat-empty">
            <p className="hint-text">
              Tell Alfred where you&apos;re stuck and he&apos;ll point at the next thing to click, one step at a time.
              Or hand him something to remember.
            </p>
            <ul className="chat-examples">
              <li>“How do I make a pie chart from this table?”</li>
              <li>“Where do I add page numbers?”</li>
              <li>“What is this error telling me?”</li>
              <li>“Remind me to submit the form at 4pm.”</li>
            </ul>
          </div>
        )}

        {messages.map((entry) => (
          <div key={entry.id} className={`chat-entry ${entry.role}`}>
            <span className="chat-author">
              {entry.role === 'assistant' ? 'Alfred' : 'You'}
              {entry.usedScreen && (
                <span className="screen-tag" title="Answered from a screenshot">
                  screen
                </span>
              )}
              {entry.cached && (
                <span className="screen-tag cached-tag" title="Same screen, same question: answered from cache">
                  instant
                </span>
              )}
            </span>
            <p>{entry.content}</p>
          </div>
        ))}

        {sending && (
          <div className="chat-entry assistant">
            <span className="chat-author">Alfred</span>
            <p className="hint-text thinking">{status}</p>
          </div>
        )}

        {error && (
          <div className="chat-entry error">
            <span className="chat-author">Alfred</span>
            <p>{error.message}</p>
            <div className="chat-error-actions">
              {error.code === 'permission-denied' && (
                <button className="ghost-button" onClick={() => window.alfred.openScreenPermissionSettings()}>
                  Open Screen Recording settings
                </button>
              )}
              <button className="ghost-button" onClick={error.retry} disabled={sending}>
                Retry
              </button>
            </div>
          </div>
        )}
      </div>

      {guide && (
        <div className="step-card">
          <div className="step-meta">
            <span>
              Step {guide.step.position} · {ACTION_WORDS[guide.step.action] ?? 'Click'}
            </span>
            <span className="step-remaining">
              {guide.steps_remaining ? `about ${guide.steps_remaining} more` : 'almost there'}
            </span>
          </div>
          <p className="step-text">{guide.step.instruction}</p>
          {!guide.step.box_2d && <p className="hint-text">I couldn&apos;t pin this one on screen, so follow the words.</p>}
          <div className="step-actions">
            <button className="action-button" onClick={() => next(null, true)} disabled={sending}>
              Done, next step ▸
            </button>
            <button className="ghost-button" onClick={() => window.alfred.guideReplay()} disabled={sending}>
              Show me again
            </button>
          </div>
          <div className="step-actions step-links">
            <button
              className="link-button"
              onClick={() => next("I can't find that. Where exactly is it?", false)}
              disabled={sending}
            >
              I can&apos;t find it
            </button>
            <button className="link-button" onClick={finish} disabled={sending}>
              ✓ It worked
            </button>
          </div>
        </div>
      )}

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={guide ? 'Ask a follow-up about this step…' : 'Where are you stuck?'}
          autoComplete="off"
          disabled={sending}
          autoFocus
        />
        <button className="action-button" type="submit" disabled={sending || !input.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
