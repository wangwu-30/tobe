/**
 * Deterministic auto-layout for canvas nodes.
 *
 * - ≤10 nodes: simple grid layout
 * - >10 nodes: layered grid (more columns, tighter spacing)
 *
 * Each strategy is deterministic (same input → same output) and requires
 * no dependency information. When edges are present, the caller can optionally
 * sort the input list before passing it (e.g. by topological order).
 */

type LayoutParams = {
  cardWidth: number;
  cardHeight: number;
  gapX: number;
  gapY: number;
  offsetX: number;
  offsetY: number;
};

const SMALL_LAYOUT: LayoutParams = {
  cardWidth: 240,
  cardHeight: 120,
  gapX: 280,
  gapY: 160,
  offsetX: 100,
  offsetY: 100,
};

const LARGE_LAYOUT: LayoutParams = {
  cardWidth: 200,
  cardHeight: 100,
  gapX: 240,
  gapY: 130,
  offsetX: 60,
  offsetY: 60,
};

const THRESHOLD = 10;

/**
 * Compute deterministic positions for `count` nodes.
 * Returns an array of {x, y} in the same order as the input.
 */
export function computeAutoLayout(count: number): Array<{ x: number; y: number }> {
  if (count === 0) return [];

  const isLarge = count > THRESHOLD;
  const layout = isLarge ? LARGE_LAYOUT : SMALL_LAYOUT;
  const cols = isLarge ? Math.ceil(Math.sqrt(count * 1.5)) : Math.min(count, 3);

  const positions: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x: layout.offsetX + col * layout.gapX,
      y: layout.offsetY + row * layout.gapY,
    });
  }

  return positions;
}

/**
 * Compute deterministic positions for `count` nodes at project-level
 * (slightly larger cards for the home canvas).
 */
export function computeProjectAutoLayout(count: number): Array<{ x: number; y: number }> {
  if (count === 0) return [];

  const isLarge = count > THRESHOLD;
  const cols = isLarge ? Math.ceil(Math.sqrt(count * 1.5)) : Math.min(count, 4);
  const gapX = isLarge ? 240 : 260;
  const gapY = isLarge ? 120 : 140;
  const offset = 80;

  const positions: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x: offset + col * gapX,
      y: offset + row * gapY,
    });
  }

  return positions;
}
