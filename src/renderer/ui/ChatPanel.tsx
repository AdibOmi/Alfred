import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type ChatMessage } from '../api';

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  // Alfred can create/complete/delete reminders as a side effect of a chat reply,
  // so the task list needs a chance to refresh after every round trip.
  onTaskActivity: () => Promise<void>;
}

export function ChatPanel({ open, onClose, onTaskActivity }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const windowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api
      .getChatHistory()
      .then(({ messages: history }) => setMessages(history))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    windowRef.current?.scrollTo({ top: windowRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('message') as HTMLInputElement;
    const text = input.value.trim();
    if (!text || sending) return;
    input.value = '';

    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: 'user', content: text, created_at: new Date().toISOString() },
    ]);
    setSending(true);
    try {
      const { reply } = await api.sendChatMessage(text);
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', content: reply, created_at: new Date().toISOString() },
      ]);
      await onTaskActivity();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', content: `Connection trouble: ${(err as Error).message}`, created_at: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={`chat-overlay ${open ? 'open' : ''}`}>
      <div className="chat-overlay-header">
        <div>
          <p className="eyebrow">Chat</p>
          <h2>Query Alfred</h2>
        </div>
        <button className="ghost-button icon-button" onClick={onClose} aria-label="Close chat">
          ✕
        </button>
      </div>
      <div className="chat-window" ref={windowRef}>
        {!loaded && <p className="hint-text">Retrieving conversation…</p>}
        {loaded && messages.length === 0 && <p className="hint-text">Systems nominal. What do you require?</p>}
        {messages.map((entry) => (
          <div key={entry.id} className={`chat-entry ${entry.role === 'assistant' ? 'assistant' : 'user'}`}>
            <span className="chat-author">{entry.role === 'assistant' ? 'Alfred' : 'You'}</span>
            <p>{entry.content}</p>
          </div>
        ))}
        {sending && (
          <div className="chat-entry assistant">
            <span className="chat-author">Alfred</span>
            <p className="hint-text">…</p>
          </div>
        )}
      </div>
      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input name="message" placeholder="Ask a question or command Alfred" autoComplete="off" disabled={sending} />
        <button className="action-button" type="submit" disabled={sending}>
          Send
        </button>
      </form>
    </section>
  );
}
