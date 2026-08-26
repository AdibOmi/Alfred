import { useEffect, useRef, useState, type FormEvent } from 'react';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
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

export function ChatPanel({ onOpenSettings, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<AskErrorState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, error]);

  const ask = async (question: string) => {
    setError(null);
    setSending(true);
    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', content: question }]);
    try {
      const result = await window.alfred.ask(question);
      if (result.ok && result.reply) {
        setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'assistant', content: result.reply as string }]);
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
    ask(text);
  };

  return (
    <div className="chat-panel">
      <div className="panel-header-row">
        <h2>Alfred</h2>
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
          <p className="hint-text">Ask about whatever&apos;s on your screen — Alfred takes one screenshot and walks you through it.</p>
        )}
        {messages.map((entry) => (
          <div key={entry.id} className={`chat-entry ${entry.role}`}>
            <span className="chat-author">{entry.role === 'assistant' ? 'Alfred' : 'You'}</span>
            <p>{entry.content}</p>
          </div>
        ))}
        {sending && (
          <div className="chat-entry assistant">
            <span className="chat-author">Alfred</span>
            <p className="hint-text">Looking…</p>
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
              <button className="ghost-button" onClick={() => ask(error.question)} disabled={sending}>
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
