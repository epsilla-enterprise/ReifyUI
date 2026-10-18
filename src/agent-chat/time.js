// Clocks for the live line. Every figure here is the difference between two observed moments; a
// missing end means "still going" (counted against now), a missing start means nothing is shown.
import { useEffect, useState } from 'react';

/** 9s, 1m 4s, 1h 2m. Under a second reads "0s": a clock that has just started, not a measurement. */
export function formatElapsed(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** A finished span, read once: 1.2s under ten seconds (the tenths mean something there), else as above. */
export function formatDuration(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.max(0.1, Math.round(ms / 100) / 10).toFixed(1)}s`;
  if (ms < 10000) return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
  return formatElapsed(ms);
}

/** 950, 12.3k, 1.2M tokens. */
export function formatTokens(n) {
  if (n == null || !isFinite(n)) return '';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(Math.round(n / 1e5) / 10).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Now, re-read every `everyMs` while `on`; frozen when off. */
export function useNow(on, everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    setNow(Date.now());
    // tick on the second boundary of the wall clock so several timers on a page change together
    let iv = null;
    const t0 = setTimeout(() => {
      setNow(Date.now());
      iv = setInterval(() => setNow(Date.now()), everyMs);
    }, everyMs - (Date.now() % everyMs));
    return () => { clearTimeout(t0); if (iv) clearInterval(iv); };
  }, [on, everyMs]);
  return now;
}

/** Milliseconds from `start` to `end` (or to now while `end` is null), or null without a start. */
export function useElapsed(start, end = null) {
  const live = start != null && end == null;
  const now = useNow(live);
  if (start == null) return null;
  return Math.max(0, (end ?? now) - start);
}
