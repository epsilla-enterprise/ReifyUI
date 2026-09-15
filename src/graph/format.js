// Display helpers shared by the graph panes (Connect, Logs) in every host.

/** "12.4 read units · 0 write units" from a consumption envelope; null when
 *  the envelope is absent so callers render an honest dash, never a made-up
 *  number. */
export function fmtUnits(c) {
  const num = (v) => (typeof v === 'number' && isFinite(v) ? (Math.round(v * 10) / 10).toString() : null);
  if (!c) return null;
  const r = num(c.read_units);
  const w = num(c.write_units);
  if (r == null && w == null) return null;
  return `${r ?? '—'} read units · ${w ?? '—'} write units`;
}

/** Relative age at every scale ("2 h ago", "3 mo ago") so the Last viewed
 *  column stays one consistent format; pair with absoluteTime in the cell
 *  title for the precise date. */
export function relativeTime(ts) {
  if (!ts) return null;
  const delta = Date.now() - ts;
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.floor(d / 365)} y ago`;
}

/** Full local date + time for tooltips; null when the stamp is unset. */
export function absoluteTime(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
