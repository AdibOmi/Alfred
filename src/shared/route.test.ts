import { describe, expect, it } from 'vitest';
import { isClearlyAboutScreen } from './route';

describe('isClearlyAboutScreen', () => {
  it.each([
    'How do I make a pie chart from my table?',
    'how to add page numbers',
    'Where is the save button',
    "where's the print option?",
    'What does this error mean?',
    'why is this greyed out',
    'Alfred, how can I insert a table here?',
    "I can't find the insert tab",
    'show me how to sort this column',
    'which button turns on track changes',
  ])('goes straight to the screen for %j', (message) => {
    expect(isClearlyAboutScreen(message)).toBe(true);
  });

  it.each([
    'remind me to call the bank at 4pm',
    'add eggs to my list',
    'how do I add a reminder for tomorrow',
    'mark the dentist one done',
    'hello',
    'thanks!',
    'what is the capital of France',
    'delete the milk task',
  ])('leaves %j to the model', (message) => {
    expect(isClearlyAboutScreen(message)).toBe(false);
  });
});
