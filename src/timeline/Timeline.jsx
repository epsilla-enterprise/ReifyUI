// A timeline: lanes of clips against a ruler, with a playhead.
//
// ONE NUMBER IS THE COORDINATE SYSTEM. `pps` — pixels per second — converts time to x everywhere:
// the ruler's ticks, a clip's width, the playhead's position, the scrub gesture's inverse. Two
// places computing the same conversion is how a ruler and the blocks under it come to disagree,
// which is the one thing a timeline cannot do and still be read.
//
// WHAT THIS COMPONENT KNOWS NOTHING ABOUT: video, audio, files, agents, or where a clip came
// from. It takes lanes of {start, duration} and draws them. Everything product-specific — what a
// clip means, what its artwork is, whether removing one is allowed — arrives as data or a
// callback. That is what lets the same component hold a film's cut, a job's phases, or a
// conversation's turns.
//
// TIME THAT IS NOT KNOWN IS NOT DRAWN AS TIME. A clip whose duration is null gets a fixed
// placeholder width and a hatched fill, never a guessed length: the whole value of drawing to
// scale is that the width is a measurement, and one invented width poisons every reading of the
// ruler above it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export const TL_MIN_PPS = 4;
export const TL_MAX_PPS = 240;
export const TL_DEFAULT_PPS = 26;
/** The sticky lane-label gutter. Lanes start at this x. */
export const TL_HEAD_W = 76;
/** Width for a clip whose duration nobody has measured yet. */
const UNKNOWN_W = 46;
const MIN_CLIP_W = 26;
const LANE_H = 48;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── ruler maths (pure) ─────────────────────────────────────────────────────────────────────── */

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** The smallest step whose labels stay ~64px apart at this zoom, so ticks thin out as you zoom
 *  out instead of collapsing into a grey bar. */
export function majorTickStep(pps) {
  for (const s of TICK_STEPS) if (s * pps >= 64) return s;
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/** m:ss, with tenths only when the step is sub-second — a label finer than the tick is noise. */
export function tickLabel(t, step = 1) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const whole = Math.floor(s + 1e-6);
  const base = `${m}:${String(whole).padStart(2, '0')}`;
  if (step >= 1) return base;
  const frac = Math.round((s - whole) * 10);
  return frac > 0 ? `${base}.${frac}` : base;
}

/** m:ss for a duration. Returns '' for anything unmeasured, never '0:00' — a zero that means
 *  "unknown" is the lie this component exists to avoid. */
export function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Where each clip sits when a lane is a sequence rather than a set of placed items: each clip
 *  starts where the last one ended. Unmeasured clips advance by their drawn width so the lane
 *  stays honest about what follows them. */
function layout(clips, pps, sequential) {
  let cursor = 0;
  return clips.map((c) => {
    const known = Number.isFinite(c.duration);
    const w = known ? Math.max(MIN_CLIP_W, c.duration * pps) : UNKNOWN_W;
    const x = sequential ? cursor * pps : (c.start || 0) * pps;
    if (sequential) cursor += known ? c.duration : UNKNOWN_W / pps;
    return { clip: c, x, w, known };
  });
}

/* ── the component ──────────────────────────────────────────────────────────────────────────── */

export function Timeline({
  tracks = [],
  /** Seconds. Drives the playhead; pass it from whatever is playing. */
  currentTime = 0,
  /** Called with a time in seconds when the ruler or lane background is scrubbed. */
  onSeek,
  onSelectClip,
  selectedClipId = null,
  /** Rendered at the right of each clip on hover — e.g. remove, reorder. (clip, index) => node */
  clipActions,
  /** Rendered after the last clip of a lane, e.g. an add button. (track) => node */
  laneAppend,
  zoomStorageKey = null,
  emptyLabel = 'Nothing here yet.',
  className = '',
}) {
  const scroller = useRef(null);
  const [pps, setPps] = useState(() => {
    if (zoomStorageKey && typeof window !== 'undefined') {
      const n = parseFloat(window.localStorage.getItem(zoomStorageKey) || '');
      if (Number.isFinite(n)) return clamp(n, TL_MIN_PPS, TL_MAX_PPS);
    }
    return TL_DEFAULT_PPS;
  });
  // Anchoring: keep the time under the pointer (or the viewport centre) still while zooming, so
  // zoom feels like moving a lens rather than being teleported.
  const anchor = useRef(null);

  const rows = useMemo(
    () => tracks.map((t) => ({ ...t, laid: layout(t.clips || [], pps, t.sequential !== false) })),
    [tracks, pps]);

  const contentSeconds = useMemo(() => {
    let end = 0;
    for (const t of rows) {
      for (const { clip, x, w } of t.laid) {
        void clip;
        end = Math.max(end, (x + w) / pps);
      }
    }
    return end;
  }, [rows, pps]);

  const setZoom = useCallback((next, clientX) => {
    const v = clamp(next, TL_MIN_PPS, TL_MAX_PPS);
    const el = scroller.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const vx = clientX === undefined ? (rect.width + TL_HEAD_W) / 2 : clientX - rect.left;
      anchor.current = { t: Math.max(0, (el.scrollLeft + vx - TL_HEAD_W) / pps), vx };
    }
    setPps(v);
    if (zoomStorageKey && typeof window !== 'undefined') {
      try { window.localStorage.setItem(zoomStorageKey, String(v)); } catch { /* private mode */ }
    }
  }, [pps, zoomStorageKey]);

  /** The zoom at which the whole cut fills the lane, with a margin. */
  const fitPps = useCallback((seconds) => {
    const el = scroller.current;
    if (!el || !(seconds > 0)) return null;
    const room = el.clientWidth - TL_HEAD_W - 48;
    if (room <= 0) return null;
    return clamp(room / seconds, TL_MIN_PPS, TL_MAX_PPS);
  }, []);

  const fit = useCallback(() => {
    const v = fitPps(contentSeconds);
    if (v !== null) { setPps(v); if (scroller.current) scroller.current.scrollLeft = 0; }
  }, [fitPps, contentSeconds]);

  // FIT ONCE, when there is first something to fit. A 1 s clip at a fixed default is a 26 px
  // sliver and reads as a broken control rather than a short shot; a 10 minute one runs off the
  // panel. Fitting on the first content is the difference between a timeline that looks designed
  // and one that looks unfinished — and it is done ONCE, not on every change, because re-fitting
  // under someone who has just zoomed in is the control fighting them.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current || !(contentSeconds > 0)) return;
    if (zoomStorageKey && typeof window !== 'undefined'
        && window.localStorage.getItem(zoomStorageKey)) { fitted.current = true; return; }
    const v = fitPps(contentSeconds);
    if (v !== null) { fitted.current = true; setPps(v); }
  }, [contentSeconds, fitPps, zoomStorageKey]);

  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || !scroller.current) return;
    anchor.current = null;
    scroller.current.scrollLeft = Math.max(0, TL_HEAD_W + a.t * pps - a.vx);
  }, [pps]);

  // Cmd/Ctrl+wheel and trackpad pinch zoom around the pointer, the way every editor does.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(pps * Math.exp(-e.deltaY * 0.0022), e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pps, setZoom]);

  const timeAt = useCallback((clientX) => {
    const el = scroller.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (el.scrollLeft + (clientX - rect.left) - TL_HEAD_W) / pps);
  }, [pps]);

  // Scrubbing: press anywhere on the ruler and drag. Pointer capture means the gesture survives
  // leaving the element, which is what makes a drag feel attached to the cursor.
  const onScrub = useCallback((e) => {
    if (!onSeek) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onSeek(timeAt(e.clientX));
    const move = (ev) => onSeek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [onSeek, timeAt]);

  const onKeyDown = useCallback((e) => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(pps * 1.35); }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(pps / 1.35); }
  }, [pps, setZoom]);

  const major = majorTickStep(pps);
  const minor = major / 5;
  const laneW = Math.max(contentSeconds * pps + 120, 240);
  const ticks = [];
  for (let t = 0; t <= contentSeconds + major; t += major) ticks.push(t);

  return (
    <div className={`rui-tl ${className}`} onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="rui-tl-scroll" ref={scroller}>
        <div className="rui-tl-inner" style={{ width: TL_HEAD_W + laneW }}>

          {/* ── ruler ────────────────────────────────────────────────────────────────────── */}
          <div className="rui-tl-row rui-tl-rulerrow">
            <div className="rui-tl-head rui-tl-rulerhead" aria-hidden="true" />
            <div
              className="rui-tl-ruler"
              style={{
                width: laneW,
                // Minor ticks are a repeating background rather than elements: at 600 s and a
                // fine zoom that is thousands of nodes, and they carry no information a stripe
                // does not.
                backgroundImage:
                  'linear-gradient(90deg, var(--uic-line, #DDDFE6) 0 1px, transparent 1px),'
                  + 'linear-gradient(90deg, var(--uic-line-soft, #EFF1F4) 0 1px, transparent 1px)',
                backgroundSize: `${major * pps}px 9px, ${minor * pps}px 5px`,
              }}
              onPointerDown={onScrub}
              role={onSeek ? 'slider' : undefined}
              aria-label={onSeek ? 'Playhead' : undefined}
              aria-valuemin={0}
              aria-valuemax={Math.round(contentSeconds)}
              aria-valuenow={Math.round(currentTime)}
              tabIndex={onSeek ? 0 : undefined}
              onKeyDown={onSeek ? (e) => {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, currentTime - step)); }
                if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(currentTime + step); }
              } : undefined}
            >
              {ticks.map((t) => (
                <span key={t} className="rui-tl-ticklbl" style={{ left: t * pps }}>
                  {tickLabel(t, major)}
                </span>
              ))}
            </div>
          </div>

          {/* ── lanes ────────────────────────────────────────────────────────────────────── */}
          {rows.length === 0 && <p className="rui-tl-empty">{emptyLabel}</p>}

          {rows.map((track) => (
            <div className="rui-tl-row" key={track.id}>
              <div className="rui-tl-head" title={track.label}>
                {track.icon}
                <span className="rui-tl-headlbl">{track.label}</span>
              </div>
              <div className="rui-tl-lane" style={{ width: laneW, height: LANE_H }}
                   onPointerDown={(e) => { if (e.target === e.currentTarget) onScrub(e); }}>
                {track.laid.length === 0 && track.emptyLabel && (
                  <p className="rui-tl-laneempty">{track.emptyLabel}</p>
                )}
                {track.laid.map(({ clip, x, w, known }, i) => (
                  <article
                    key={clip.id ?? i}
                    className={'rui-tl-clip'
                      + (clip.state ? ` is-${clip.state}` : '')
                      + (known ? '' : ' is-unmeasured')
                      + (selectedClipId === clip.id ? ' is-selected' : '')}
                    style={{ left: x, width: w, ...(clip.accent ? { '--rui-tl-accent': clip.accent } : null) }}
                    title={clip.title || clip.label}
                    tabIndex={0}
                    onClick={() => onSelectClip?.(clip, i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectClip?.(clip, i); }
                    }}
                  >
                    {clip.poster
                      ? <img className="rui-tl-poster" src={clip.poster} alt="" loading="lazy" />
                      : <span className="rui-tl-blank" aria-hidden="true">{clip.glyph}</span>}
                    {clip.badge && <span className="rui-tl-badge">{clip.badge}</span>}
                    {/* A duration only when one was measured. See durationLabel. */}
                    {known && w > 44 && (
                      <span className="rui-tl-dur">{durationLabel(clip.duration)}</span>
                    )}
                    {clip.label && w > 96 && <span className="rui-tl-name">{clip.label}</span>}
                    {clipActions && <span className="rui-tl-acts">{clipActions(clip, i)}</span>}
                  </article>
                ))}
                {laneAppend && (
                  <span className="rui-tl-append"
                        style={{ left: track.laid.reduce((n, l) => Math.max(n, l.x + l.w), 0) + 4 }}>
                    {laneAppend(track)}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* ── playhead ─────────────────────────────────────────────────────────────────────
              Drawn last so it sits above the lanes, and only when there is a time to show. */}
          {Number.isFinite(currentTime) && contentSeconds > 0 && (
            <div className="rui-tl-playhead" style={{ left: TL_HEAD_W + currentTime * pps }}
                 aria-hidden="true">
              <span className="rui-tl-playhead-grip" />
            </div>
          )}
        </div>
      </div>

      <div className="rui-tl-zoom">
        <button type="button" className="rui-tl-zoombtn" aria-label="Zoom out"
                onClick={() => setZoom(pps / 1.35)} disabled={pps <= TL_MIN_PPS + 1e-6}>−</button>
        <button type="button" className="rui-tl-zoombtn" aria-label="Zoom in"
                onClick={() => setZoom(pps * 1.35)} disabled={pps >= TL_MAX_PPS - 1e-6}>+</button>
        <button type="button" className="rui-tl-zoombtn rui-tl-fit" aria-label="Fit to width"
                title="Fit to width" onClick={fit} disabled={!(contentSeconds > 0)}>⤢</button>
      </div>
    </div>
  );
}
