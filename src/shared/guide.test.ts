import { describe, expect, it } from 'vitest';
import { boxToRect, panelSpotAvoiding, rectsOverlap } from './guide';

describe('boxToRect', () => {
  it('scales a normalised box onto the display', () => {
    expect(boxToRect([100, 250, 200, 500], { width: 1920, height: 1080 })).toEqual({
      x: 480,
      y: 108,
      width: 480,
      height: 108,
    });
  });

  it('returns null when the model had nothing to point at', () => {
    expect(boxToRect(null, { width: 1920, height: 1080 })).toBeNull();
  });

  it('never produces an empty rectangle', () => {
    const rect = boxToRect([500, 500, 500, 500], { width: 800, height: 600 });
    expect(rect?.width).toBe(1);
    expect(rect?.height).toBe(1);
  });
});

describe('panelSpotAvoiding', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const panel = { x: 1516, y: 456, width: 380, height: 560 };

  it('keeps the panel where it is when the target is elsewhere', () => {
    expect(panelSpotAvoiding(panel, workArea, { x: 40, y: 40, width: 80, height: 30 })).toEqual(panel);
  });

  it('moves the panel to another corner when it would cover the target', () => {
    const target = { x: 1600, y: 700, width: 120, height: 40 };
    const spot = panelSpotAvoiding(panel, workArea, target);
    expect(rectsOverlap(spot, target)).toBe(false);
    expect(spot).toEqual({ x: 24, y: 456, width: 380, height: 560 });
  });

  it('stays put when there is no target', () => {
    expect(panelSpotAvoiding(panel, workArea, null)).toBe(panel);
  });
});
