import { describe, expect, it } from 'vitest';
import { trimHistory, type ChatTurn } from './history';

function conversation(turns: number): ChatTurn[] {
  return Array.from({ length: turns }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `message ${index}`,
  }));
}

describe('trimHistory', () => {
  it('keeps a short conversation untouched', () => {
    const turns = conversation(4);
    expect(trimHistory(turns, 8)).toEqual(turns);
  });

  it('never starts the history on an assistant turn', () => {
    // The regression: a plain tail slice of a 9-turn conversation starts at
    // index 1, which is an assistant reply, and the Messages API rejects that.
    const trimmed = trimHistory(conversation(9), 8);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed).toHaveLength(7);
  });

  it('keeps the most recent turns, not the oldest', () => {
    const trimmed = trimHistory(conversation(9), 8);
    expect(trimmed[trimmed.length - 1].content).toBe('message 8');
  });

  it('returns nothing when the window holds no user turn at all', () => {
    expect(trimHistory([{ role: 'assistant', content: 'orphaned reply' }], 8)).toEqual([]);
  });

  it('returns nothing for an empty conversation or a zero window', () => {
    expect(trimHistory([], 8)).toEqual([]);
    expect(trimHistory(conversation(4), 0)).toEqual([]);
  });
});
