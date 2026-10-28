// Where a sprite actually lands on the device's screen. Mirrors the placement
// in device-apps/improv/src/compositor.lua, so the layer bounds check,
// build-app and preview-layout share one set of numbers.
//
// The 32x32 authoring cell is not the screen: at 6x a cell is 192px wide
// against a 135px screen, and placement centres on the ink box, so edge
// columns are off-screen for every 6x actor while ~44px of screen sits unused
// above. Art is bounded by the screen, not by the cell.

export const SCREEN_W = 135;
export const SCREEN_H = 240;
export const BASELINE_Y = 236; // grounded actors: lowest inked row lands here
export const MOON_Y = 8; // miss_moon hangs from the top instead

// Mirrors S.ACTOR_SCALE in compositor.lua -- keep the two sides in sync.
export const ACTOR_SCALE: Record<string, number> = {
  ada: 6,
  bruno: 6,
  milo: 6,
  rosa: 6,
  pip: 6,
  tuk: 6,
  miss_moon: 4,
};
export const SCALE_DEFAULT = 4;

export function actorScale(id: string): number {
  return ACTOR_SCALE[id] ?? SCALE_DEFAULT;
}

/** Ink extents of a grid: column span for centering, first inked row, 1-based bottom for grounding. */
export function inkBox(base: string[]): { left: number; top: number; width: number; bottom: number } {
  let left = base[0]?.length ?? 0;
  let right = 0;
  let top = base.length;
  let bottom = 0;
  base.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === ".") continue;
      if (x < left) left = x;
      if (x + 1 > right) right = x + 1;
      if (y < top) top = y;
      bottom = Math.max(bottom, y + 1);
    }
  });
  return { left, top, width: right - left, bottom };
}

/** Screen position of the actor's cell origin — cell (0,0) maps here. */
export function cellOrigin(id: string, base: string[]): { x: number; y: number; scale: number } {
  const scale = actorScale(id);
  const box = inkBox(base);
  return {
    x: Math.floor((SCREEN_W - box.width * scale) / 2) - box.left * scale,
    y: id === "miss_moon" ? MOON_Y : BASELINE_Y - box.bottom * scale,
    scale,
  };
}

/** Tight inked bounds of a grid in grid coords, or null when nothing is inked. */
export function inkExtent(grid: string[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === ".") continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  });
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}

export interface Overflow {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How far a layer's INK falls outside the screen once anchored on `actorId`,
 * in device pixels. Returns null when it fits.
 *
 * Bounds the inked pixels rather than the grid rectangle, so padding a grid to
 * centre it is free — only what actually draws has to land on screen.
 */
export function screenOverflow(
  actorId: string,
  base: string[],
  anchor: { x: number; y: number; px: number },
  grid: string[],
): Overflow | null {
  const ink = inkExtent(grid);
  if (!ink) return null; // a blank layer draws nothing and cannot overflow
  // anchor is already in render pixels from the cell origin (layerAnchor), and
  // anchor.px is the size of one grid cell -- half the actor scale for 2x art.
  const { x: ox, y: oy } = cellOrigin(actorId, base);
  const x0 = ox + anchor.x + ink.x0 * anchor.px;
  const y0 = oy + anchor.y + ink.y0 * anchor.px;
  const x1 = ox + anchor.x + (ink.x1 + 1) * anchor.px;
  const y1 = oy + anchor.y + (ink.y1 + 1) * anchor.px;
  const over: Overflow = {
    left: Math.max(0, -x0),
    right: Math.max(0, x1 - SCREEN_W),
    top: Math.max(0, -y0),
    bottom: Math.max(0, y1 - SCREEN_H),
  };
  return over.left || over.right || over.top || over.bottom ? over : null;
}

/**
 * The part of `over` a layer has NOT been given permission to spill, or null
 * when the whole overflow is within budget.
 *
 * `bleedX` is a per-side horizontal allowance in screen pixels, from the
 * layer's sidecar: it separates art that runs off the frame on purpose from
 * art clipped by accident. The default is 0. Vertical overflow is passed
 * through at any budget: above the actor is headroom the bound already
 * permits, and below the baseline is under the floor.
 */
export function overflowViolation(over: Overflow | null, bleedX: number): Overflow | null {
  if (!over) return null;
  const rest: Overflow = {
    left: Math.max(0, over.left - bleedX),
    right: Math.max(0, over.right - bleedX),
    top: over.top,
    bottom: over.bottom,
  };
  return rest.left || rest.right || rest.top || rest.bottom ? rest : null;
}

/** "11px off the left, 10px off the right" — for error messages. */
export function describeOverflow(over: Overflow): string {
  const parts: string[] = [];
  if (over.left) parts.push(`${over.left}px off the left`);
  if (over.right) parts.push(`${over.right}px off the right`);
  if (over.top) parts.push(`${over.top}px off the top`);
  if (over.bottom) parts.push(`${over.bottom}px off the bottom`);
  return parts.join(", ");
}

/**
 * The same violation as an author-facing phrase, naming the budget when the
 * layer declared one: "7px off the left, 6px off the right beyond its
 * declared bleed_x of 4px". Without the clause, the residual reads as the
 * whole overflow. Every site that reports a violation uses this. The budget
 * is named only for a horizontal violation, since bleed_x never excuses a
 * vertical one.
 */
export function describeViolation(violation: Overflow, bleedX: number): string {
  const budget =
    bleedX && (violation.left || violation.right) ? ` beyond its declared bleed_x of ${bleedX}px` : "";
  return `${describeOverflow(violation)}${budget}`;
}
