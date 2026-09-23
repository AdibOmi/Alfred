import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatTurn } from '../../shared/history';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Set on assistant replies that were answered by looking at the screen. */
  usedScreen?: boolean;
}

interface AskErrorState {
  code: 'permission-denied' | 'api-error';
  message: string;
  question: string;
}

interface ChatPanelProps {
  onOpenSettings: () => void;
  onClose: () => void;
}

// How many previous turns travel with each question. Enough for "remind me at
// 5pm" -> "about what?" -> "the dentist" to resolve, without letting a long
// session quietly inflate every request.
const HISTORY_TURNS = 8;

export function ChatPanel({ onOpenSettings, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<AskErrorState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, error, sending]);

  const ask = async (question: string, priorMessages: ChatMessage[]) => {
    setError(null);
    setSending(true);

    const history: ChatTurn[] = priorMessages
      .slice(-HISTORY_TURNS)
      .map((entry) => ({ role: entry.role, content: entry.content }));

    try {
      const result = await window.alfred.ask(question, history);
      if (result.ok && result.reply) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, role: 'assistant', content: result.reply as string, usedScreen: result.usedScreen },
        ]);
      } else if (result.code === 'no-api-key') {
        onOpenSettings();
      } else {
        setError({
          code: (result.code as 'permission-denied' | 'api-error') ?? 'api-error',
          message: result.message ?? 'Something went wrong.',
          question,
        });
      }
    } catch (err) {
      setError({ code: 'api-error', message: (err as Error).message, question });
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput('');

    // The history sent with the request is everything before this question, so
    // it is captured here rather than read back out of state after the append.
    const priorMessages = messages;
    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', content: text }]);
    ask(text, priorMessages);
  };

  const retry = () => {
    if (!error) return;
    const priorMessages = messages.filter((entry) => entry.content !== error.question || entry.role !== 'user');
    ask(error.question, priorMessages);
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
            <p className="hint-text">Ask about whatever is on your screen, or hand Alfred something to remember.</p>
            <ul className="chat-examples">
              <li>“How do I delete a blank page in Word?”</li>
              <li>“What is this error telling me?”</li>
              <li>“Remind me to submit the form at 4pm.”</li>
              <li>“Add buy milk to my list.”</li>
            </ul>
          </div>
        )}

        {messages.map((entry) => (
          <div key={entry.id} className={`chat-entry ${entry.role}`}>
            <span className="chat-author">
              {entry.role === 'assistant' ? 'Alfred' : 'You'}
              {entry.usedScreen && <span className="screen-tag" title="Answered from a screenshot">screen</span>}
            </span>
            <p>{entry.content}</p>
          </div>
        ))}

        {sending && (
          <div className="chat-entry assistant">
            <span className="chat-author">Alfred</span>
            <p className="hint-text">Thinking…</p>
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
              <button className="ghost-button" onClick={retry} disabled={sending}>
                Retry
              </button>
            </div>
          </div>
        )}
      </div>

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="How do I…?"
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
