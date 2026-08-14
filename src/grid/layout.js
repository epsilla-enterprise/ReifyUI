// Grid layout math for PanelGrid — pure functions over an array of {i, x, y, w, h}.
//
// Kept separate from the component because this is the part that is easy to get wrong and easy
// to test: nothing here touches the DOM, React, or pixels. Coordinates are CELLS, not pixels —
// x/w are columns, y/h are rows. The component owns the one conversion to pixels.
//
// Gravity is up and always on. A dashboard with holes punched in it looks broken rather than
// deliberate, and "the panel you dropped is where you dropped it, everything else flows around
// it" is the only rule a person has to learn.

/** Sorted top-to-bottom, then left-to-right — the order gravity resolves in. */
export function sortLayout(layout) {
  return [...layout].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function overlaps(a, b) {
  return a.i !== b.i
    && a.x < b.x + b.w && a.x + a.w > b.x
    && a.y < b.y + b.h && a.y + a.h > b.y;
}

function firstOverlap(placed, item) {
  for (const p of placed) if (overlaps(p, item)) return p;
  return null;
}

/** Cell bounds an item may occupy. min defaults to 1 cell; max defaults to the whole grid. */
export function clampItem(item, cols) {
  const minW = Math.max(1, item.minW || 1);
  const minH = Math.max(1, item.minH || 1);
  const w = Math.min(Math.max(item.w ?? minW, minW), Math.min(item.maxW || cols, cols));
  const h = Math.max(Math.min(item.h ?? minH, item.maxH || Infinity), minH);
  const x = Math.min(Math.max(item.x ?? 0, 0), cols - w);
  return { ...item, x, y: Math.max(0, item.y ?? 0), w, h };
}

/**
 * Float everything up, resolving overlaps on the way.
 *
 * `pinned` is the id being dragged, and it wins TIES: dropped onto the cell of a panel already
 * there, it keeps the cell and the other one moves, instead of the panel squirting out from under
 * the pointer because its neighbour happened to sort first. Only ties — a pin that always went
 * first would float above the panel it was just dragged below, so nudging a panel DOWN one row
 * could send it to the top of the board.
 */
export function compact(layout, cols, pinned) {
  const sorted = layout.map((it) => clampItem(it, cols))
    .sort((a, b) => (a.y - b.y) || (Number(b.i === pinned) - Number(a.i === pinned)) || (a.x - b.x));
  const statics = sorted.filter((it) => it.static);
  const rest = sorted.filter((it) => !it.static);
  const placed = [...statics];
  for (const item of rest) {
    let y = item.y;
    // Rise until something is in the way…
    while (y > 0 && !firstOverlap(placed, { ...item, y: y - 1 })) y--;
    // …and sink out of anything it is already inside (a drop, or a resize that grew downward).
    let hit;
    while ((hit = firstOverlap(placed, { ...item, y }))) y = hit.y + hit.h;
    placed.push({ ...item, y });
  }
  // Back into the caller's order: a layout array whose order shuffles every drag makes React
  // remount panels, and a remounted chart loses its animation and its tooltip.
  const byId = new Map(placed.map((it) => [it.i, it]));
  return layout.map((it) => byId.get(it.i) || it);
}

/** Move one item to a cell, then let gravity settle the rest around it. */
export function moveItem(layout, id, x, y, cols) {
  const next = layout.map((it) => (it.i === id && !it.static
    ? clampItem({ ...it, x, y: Math.max(0, y) }, cols)
    : it));
  return compact(next, cols, id);
}

/**
 * Move one item by one step, the way a keyboard means it.
 *
 * Sideways is literal. Vertically it is a SWAP with the neighbour above or below, because under
 * gravity "down one row" is not a thing that can happen: the row it vacates closes behind it and
 * it lands exactly where it started. A key that provably cannot move anything is a dead key, so
 * up/down step past the panel that is blocking, and do nothing only when there is genuinely
 * nothing to step past.
 */
export function nudgeItem(layout, id, dx, dy, cols) {
  const item = layout.find((it) => it.i === id);
  if (!item || item.static) return layout;
  if (dx) return moveItem(layout, id, item.x + dx, item.y, cols);
  const sameCols = layout.filter((o) => o.i !== id && o.x < item.x + item.w && o.x + o.w > item.x);
  if (dy < 0) {
    const above = sameCols.filter((o) => o.y + o.h <= item.y);
    if (!above.length) return layout;
    const near = above.reduce((a, b) => (a.y + a.h > b.y + b.h ? a : b));
    return moveItem(layout, id, item.x, near.y, cols);      // takes its row; it is pushed down
  }
  const below = sameCols.filter((o) => o.y >= item.y + item.h);
  if (!below.length) return layout;
  const near = below.reduce((a, b) => (a.y < b.y ? a : b));
  return moveItem(layout, id, item.x, near.y + near.h, cols); // it floats up into the gap left
}

/** Resize one item from its top-left corner, then settle. */
export function resizeItem(layout, id, w, h, cols) {
  const next = layout.map((it) => (it.i === id && !it.static
    ? clampItem({ ...it, w, h }, cols)
    : it));
  return compact(next, cols, id);
}

/** Rows the layout occupies — the grid's height, which is knowable before any measurement. */
export function layoutRows(layout) {
  return layout.reduce((n, it) => Math.max(n, (it.y || 0) + (it.h || 1)), 0);
}

/** True when two layouts place every item identically — used to skip no-op commits. */
export function sameLayout(a, b) {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((it) => [it.i, it]));
  return a.every((it) => {
    const o = byId.get(it.i);
    return o && o.x === it.x && o.y === it.y && o.w === it.w && o.h === it.h;
  });
}
