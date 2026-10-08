// Snaps Alfred's pointer onto the real element. The model names the element ("Insert",
// "Page Number"); OCR says exactly where that text sits on the screenshot. Electron-free so it
// can be unit-tested directly.

import type { Box2d } from './guide';

export interface OcrWord {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrLine {
  t: string;
  w: OcrWord[];
}

// Words a model adds around a label that never appear in the label itself on screen.
const FILLER = new Set(['the', 'tab', 'button', 'menu', 'icon', 'option', 'link', 'field', 'box', 'checkbox', 'item', 'command', 'dropdown', 'ribbon', 'group', 'entry']);

function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”"'`.,:;!?()[\]{}<>…→▸»«|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words of a model's target_label that should literally appear on screen. */
export function labelWords(label: string): string[] {
  const words = clean(label).split(' ').filter(Boolean);
  const trimmed = [...words];
  while (trimmed.length > 1 && FILLER.has(trimmed[0])) trimmed.shift();
  while (trimmed.length > 1 && FILLER.has(trimmed[trimmed.length - 1])) trimmed.pop();
  return trimmed;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = next;
  }
  return prev[b.length];
}

/** 1 for identical text, falling towards 0; tolerant of the odd character OCR gets wrong. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - editDistance(a, b) / longest;
}

const MIN_SIMILARITY = 0.8;

interface Candidate {
  score: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Finds the on-screen text that matches `label` and returns its box, normalised 0-1000 over the
 * image like the model's own box_2d. When the text appears more than once (a "Save" button and
 * a "Save" menu item) the match nearest the model's own guess wins. Null when nothing matches
 * well enough: pointing nowhere beats pointing at the wrong thing.
 */
export function findLabel(
  lines: OcrLine[],
  label: string | null,
  image: { width: number; height: number },
  hint: Box2d | null = null,
): Box2d | null {
  if (!label || image.width <= 0 || image.height <= 0) return null;
  const target = labelWords(label);
  if (target.length === 0) return null;
  const wanted = target.join(' ');

  const candidates: Candidate[] = [];
  for (const line of lines) {
    const words = line.w.map((word) => ({ ...word, c: clean(word.t) })).filter((word) => word.c);
    for (let start = 0; start + target.length <= words.length; start += 1) {
      const span = words.slice(start, start + target.length);
      const score = similarity(span.map((word) => word.c).join(' '), wanted);
      if (score < MIN_SIMILARITY) continue;
      candidates.push({
        score,
        left: Math.min(...span.map((word) => word.x)),
        top: Math.min(...span.map((word) => word.y)),
        right: Math.max(...span.map((word) => word.x + word.w)),
        bottom: Math.max(...span.map((word) => word.y + word.h)),
      });
    }
  }
  if (candidates.length === 0) return null;

  const hintCentre = hint && {
    x: (((hint[1] + hint[3]) / 2) * image.width) / 1000,
    y: (((hint[0] + hint[2]) / 2) * image.height) / 1000,
  };
  const distance = (c: Candidate) =>
    hintCentre ? Math.hypot((c.left + c.right) / 2 - hintCentre.x, (c.top + c.bottom) / 2 - hintCentre.y) : 0;
  candidates.sort((a, b) => b.score - a.score || distance(a) - distance(b));
  const best = candidates[0];

  // A little breathing room: the clickable element is a touch bigger than its text.
  const padX = 6;
  const padY = 4;
  const norm = (value: number, size: number) => Math.max(0, Math.min(1000, Math.round((value / size) * 1000)));
  return [
    norm(best.top - padY, image.height),
    norm(best.left - padX, image.width),
    norm(best.bottom + padY, image.height),
    norm(best.right + padX, image.width),
  ];
}
