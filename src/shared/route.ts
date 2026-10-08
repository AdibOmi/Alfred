// Recognises messages that can only be about the screen ("how do I…", "where is…", "what does
// this error mean"), so Alfred can go straight to looking instead of first asking a model what
// the message needs. Anything less clear-cut, and anything that sounds like a to-do, still goes
// through the model. Electron-free so it can be unit-tested directly.

const SCREEN_OPENERS = [
  /^(so |ok,? |okay,? |hey,? |alfred,? |please,? )*(how (do|can|would|should|could) (i|we|you)|how to)\b/,
  /^(so |ok,? |okay,? |hey,? |alfred,? |please,? )*where('s| is| are| do| can| would)\b/,
  /^(so |ok,? |okay,? |hey,? |alfred,? |please,? )*(what|why) (is|does|are|do|did|won't|can't|isn't) (this|that|these|those|it|my|the (error|warning|message|button|icon|popup|dialog))\b/,
  /^(so |ok,? |okay,? |hey,? |alfred,? |please,? )*(show me|help me (to |with |find |do )|i can'?t find|i cannot find|which (button|menu|tab|option)|walk me through)\b/,
];

// Words that mean the message is (also) about the task list, which only the model can handle.
const TASK_WORDS = /\b(remind|reminder|reminders|to-?do|todos|task|tasks|my list|schedule|alarm|deadline)\b/;

export function isClearlyAboutScreen(message: string): boolean {
  const text = message.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text.length < 6 || TASK_WORDS.test(text)) return false;
  return SCREEN_OPENERS.some((pattern) => pattern.test(text));
}
