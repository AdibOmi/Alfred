import { describe, expect, it } from 'vitest';
import { defaultIconPosition, expandedBounds, thumbnailSizeFor } from './geometry';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

describe('defaultIconPosition', () => {
  it('sits in the bottom-right corner, inset by the margin', () => {
    expect(defaultIconPosition(WORK_AREA, 56, 24)).toEqual({ x: 1920 - 56 - 24, y: 1080 - 56 - 24 });
  });
});

describe('expandedBounds', () => {
  it('grows up and to the left from the icon when there is room', () => {
    const icon = { x: 1840, y: 1000 };
    const bounds = expandedBounds(icon, 56, 360, 480, WORK_AREA);
    expect(bounds).toEqual({ x: 1840 + 56 - 360, y: 1000 + 56 - 480, width: 360, height: 480 });
  });

  it('clamps to the work area when the icon sits in a corner with no room to grow', () => {
    const icon = { x: 0, y: 0 };
    const bounds = expandedBounds(icon, 56, 360, 480, WORK_AREA);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(WORK_AREA.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(WORK_AREA.height);
  });

  it('never extends past the right or bottom edge of the work area', () => {
    const icon = { x: 1900, y: 1060 };
    const bounds = expandedBounds(icon, 56, 360, 480, WORK_AREA);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(WORK_AREA.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(WORK_AREA.height);
  });
});

describe('thumbnailSizeFor', () => {
  it('leaves small displays untouched', () => {
    expect(thumbnailSizeFor({ width: 1280, height: 720 }, 1568)).toEqual({ width: 1280, height: 720 });
  });

  it('downscales large displays to the max edge while preserving aspect ratio', () => {
    const size = thumbnailSizeFor({ width: 3840, height: 2160 }, 1568);
    expect(Math.max(size.width, size.height)).toBe(1568);
    expect(size.width / size.height).toBeCloseTo(3840 / 2160, 2);
  });
});
