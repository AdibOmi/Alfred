import { describe, expect, it } from 'vitest';
import { findLabel, labelWords, similarity, type OcrLine } from './snap';

const image = { width: 1600, height: 900 };

const word = (t: string, x: number, y: number, w = 50, h = 16) => ({ t, x, y, w, h });

// A cut-down Word ribbon, as Windows OCR reports it.
const ribbon: OcrLine[] = [
  { t: 'File', w: [word('File', 21, 12, 34)] },
  { t: 'Insert', w: [word('Insert', 262, 12, 52)] },
  { t: 'Chart', w: [word('Chart', 381, 82, 52)] },
  { t: 'Page Number', w: [word('Page', 551, 82, 50, 20), word('Number', 608, 82, 77)] },
  { t: 'Save', w: [word('Save', 100, 12)] },
  { t: 'Save', w: [word('Save', 1400, 820)] },
];

describe('labelWords', () => {
  it('drops the filler a model adds around a label', () => {
    expect(labelWords('the Insert tab')).toEqual(['insert']);
    expect(labelWords('"Page Number" button')).toEqual(['page', 'number']);
  });

  it('keeps a label that is only a filler word', () => {
    expect(labelWords('Menu')).toEqual(['menu']);
  });
});

describe('similarity', () => {
  it('tolerates a single misread character', () => {
    expect(similarity('lnsert', 'insert')).toBeGreaterThan(0.8);
    expect(similarity('chart', 'table')).toBeLessThan(0.5);
  });
});

describe('findLabel', () => {
  it('boxes a single word exactly, normalised to 0-1000', () => {
    // Insert spans x 262-314, y 12-28; padded by 6px and 4px.
    expect(findLabel(ribbon, 'Insert', image)).toEqual([9, 160, 36, 200]);
  });

  it('matches multi-word labels across words and ignores filler', () => {
    const box = findLabel(ribbon, 'the Page Number button', image);
    expect(box).toEqual([87, 341, 118, 432]);
  });

  it('is case-insensitive and tolerant of OCR slips', () => {
    expect(findLabel([{ t: 'lnsert', w: [word('lnsert', 262, 12, 52)] }], 'INSERT', image)).not.toBeNull();
  });

  it('prefers the copy nearest the model’s own guess', () => {
    const nearBottomRight = findLabel(ribbon, 'Save', image, [900, 850, 940, 900]);
    expect(nearBottomRight?.[1]).toBeGreaterThan(800);
    const nearTopLeft = findLabel(ribbon, 'Save', image, [0, 50, 40, 90]);
    expect(nearTopLeft?.[1]).toBeLessThan(100);
  });

  it('returns null rather than guessing', () => {
    expect(findLabel(ribbon, 'Pictures', image)).toBeNull();
    expect(findLabel(ribbon, null, image)).toBeNull();
    expect(findLabel([], 'Insert', image)).toBeNull();
  });
});
