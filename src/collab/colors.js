// One palette for everyone who shows up in a shared document: the cursor in a
// doc, the selection in a sheet, the drag on a graph canvas. A person's color
// comes from their member id, so they look the same in every surface and to
// every viewer, with no per-document assignment to disagree.
export const PEER_PALETTE = ['#1e40af', '#c2410c', '#15803d', '#6d28d9', '#be123c', '#0e7490', '#a16207', '#4338ca'];

export function peerColor(key) {
  let h = 0;
  for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PEER_PALETTE[h % PEER_PALETTE.length];
}

/** rgba() of a #rrggbb color. */
export function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}
