export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function defaultIconPosition(workArea: Rect, iconSize: number, margin: number): Point {
  return {
    x: workArea.x + workArea.width - iconSize - margin,
    y: workArea.y + workArea.height - iconSize - margin,
  };
}

// The panel grows out of whichever corner the icon's bottom-right sits at, then
// gets clamped back onto the containing display so it can never end up
// partially off-screen regardless of where the icon was left.
export function expandedBounds(iconPosition: Point, iconSize: number, panelWidth: number, panelHeight: number, workArea: Rect): Rect {
  let x = iconPosition.x + iconSize - panelWidth;
  let y = iconPosition.y + iconSize - panelHeight;

  x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - panelWidth);
  y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - panelHeight);

  return { x, y, width: panelWidth, height: panelHeight };
}

export interface Size {
  width: number;
  height: number;
}

// Claude resizes images internally above ~1568px on the long edge without any
// quality benefit, so capturing at that size keeps requests fast and cheap
// without losing anything the model would actually use.
export function thumbnailSizeFor(displayBounds: Size, maxEdge: number): Size {
  const scale = Math.min(1, maxEdge / Math.max(displayBounds.width, displayBounds.height));
  return {
    width: Math.round(displayBounds.width * scale),
    height: Math.round(displayBounds.height * scale),
  };
}
