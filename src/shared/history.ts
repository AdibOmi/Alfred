// The shape of a chat turn as it crosses the renderer/main boundary, plus the
// one rule that governs it. Electron-free so it can be unit-tested directly.

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Takes the tail of a conversation and makes it a legal request history.
 *
 * The Messages API requires the first message to come from the user. A plain
 * tail slice breaks that roughly half the time — on an alternating
 * conversation, any even-length window lands on an assistant reply — so the
 * leading assistant turns are dropped rather than sent.
 */
export function trimHistory(turns: ChatTurn[], maxTurns: number): ChatTurn[] {
  const recent = maxTurns > 0 ? turns.slice(-maxTurns) : [];
  const firstUser = recent.findIndex((turn) => turn.role === 'user');
  return firstUser === -1 ? [] : recent.slice(firstUser);
}
