// Alfred's emblem: a butler's bow tie whose wings are bat wings, with a bat-eared knot. The one
// source of truth for the floating icon (rendered as inline SVG) and for the app and tray icons
// (rasterised by scripts/generate-icons.js, which reads these strings straight out of this file).
//
// 64 x 64 viewBox. Absolute M / L / Q / C / Z commands only, so the icon script can parse them.
// Each entry is a separate filled shape; where they overlap they simply union.

export const EMBLEM_VIEWBOX = 64;

export const EMBLEM_PATHS: string[] = [
  // left wing: a swept leading edge, then the scalloped trailing edge of a bat wing
  'M 29 29.5 C 22 25.5 13 21 3.5 15.5 Q 11 24 8.5 34 Q 12.5 28.5 17 31.5 Q 20.5 32.5 22.5 39 Q 25 34.5 29 34.5 Z',
  // right wing, mirrored
  'M 35 29.5 C 42 25.5 51 21 60.5 15.5 Q 53 24 55.5 34 Q 51.5 28.5 47 31.5 Q 43.5 32.5 41.5 39 Q 39 34.5 35 34.5 Z',
  // the knot, with two bat ears
  'M 28.2 36.5 L 28.2 27.5 L 29.4 22 L 31 25.6 L 33 25.6 L 34.6 22 L 35.8 27.5 L 35.8 36.5 Q 32 38.2 28.2 36.5 Z',
];
