// A timeline you can edit: lanes of clips against a ruler, with a playhead, trim handles, split,
// and drag to reorder.
//
// ONE NUMBER IS THE COORDINATE SYSTEM. `pps` — pixels per second — converts time to x everywhere:
// the ruler's ticks, a clip's width, the playhead, every gesture's inverse. Two places computing
// that conversion is how a ruler and the blocks under it come to disagree, which is the one thing
// a timeline cannot do and still be read.
//
// THE HOST OWNS THE DOCUMENT. Every gesture ends in a callback carrying SECONDS — onTrim, onSplit,
// onMoveClip, onDeleteClip — and nothing here mutates anything. That is what lets the same
// component drive a film's cut, a job's phases or a conversation's turns: it knows about time and
// blocks and nothing about what a block means. It also puts undo where the document is.
//
// TIME THAT IS NOT KNOWN IS NOT DRAWN AS TIME. A clip whose duration is null gets a fixed
// placeholder width and a hatched fill, never a guessed length — a width here is a measurement,
// and one invented width makes every reading of the ruler above it worthless. Such a clip also
// gets no trim handles: there is nothing to trim against a length nobody knows.
//
// ARTWORK IS ONE REAL FRAME, REPEATED. A filmstrip in a desktop editor shows successive frames
// pulled from the file. There is no frame-extraction service behind this component, so it tiles
// the ONE poster it was given at a fixed tile size rather than inventing distinct frames —
// visibly the same image, which is honest about what is known, and still reads as a strip.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export const TL_MIN_PPS = 4;
export const TL_MAX_PPS = 400;
export const TL_DEFAULT_PPS = 26;
/** The sticky lane-label gutter. Lanes start at this x. */
export const TL_HEAD_W = 84;
/** Snap magnetism in screen px. Alt bypasses it, the convention everywhere. */
export const TL_SNAP_PX = 6;
/** Nothing may be trimmed shorter than this. */
export const TL_MIN_CLIP_S = 0.1;
/** Pointer travel below which a press is a click, not a drag. */
const CLICK_SLOP = 3;

const LANE_H = 56;
const CLIP_INSET = 4;
const UNKNOWN_W = 46;
const MIN_CLIP_W = 18;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── ruler + label maths (pure) ─────────────────────────────────────────────────────────────── */

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** The smallest step whose labels stay ~64px apart, so ticks thin out as you zoom out instead of
 *  collapsing into a grey bar. */
export function majorTickStep(pps) {
  for (const s of TICK_STEPS) if (s * pps >= 64) return s;
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/** m:ss, with tenths only when the step is sub-second — a label finer than its tick is noise. */
export function tickLabel(t, step = 1) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const whole = Math.floor(s + 1e-6);
  const base = `${m}:${String(whole).padStart(2, '0')}`;
  if (step >= 1) return base;
  const frac = Math.round((s - whole) * 10);
  return frac > 0 ? `${base}.${frac}` : base;
}

/** m:ss for a duration, and '' for anything unmeasured — never '0:00' for an unknown. */
export function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Precise enough to trim against: m:ss.t */
function exactLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** Where each clip sits. A sequential lane runs its clips end to end (a cut); a placed lane puts
 *  each at its own `start`. An unmeasured clip advances by its drawn width, so what follows it
 *  stays honest about being approximate. */
function layout(clips, pps, sequential) {
  let cursor = 0;
  return clips.map((c, i) => {
    const known = Number.isFinite(c.duration);
    const w = known ? Math.max(MIN_CLIP_W, c.duration * pps) : UNKNOWN_W;
    const t0 = sequential ? cursor : (c.start || 0);
    if (sequential) cursor += known ? c.duration : UNKNOWN_W / pps;
    return { clip: c, i, t0, x: t0 * pps, w, known };
  });
}

/** The nearest snap target within `tol` seconds, or the raw value. */
function snapTo(t, targets, tol) {
  let best = null;
  let bestD = tol;
  for (const s of targets) {
    const d = Math.abs(s - t);
    if (d <= bestD) { bestD = d; best = s; }
  }
  return best === null ? { value: t, guide: null } : { value: best, guide: best };
}

/* ── the component ──────────────────────────────────────────────────────────────────────────── */

export function Timeline({
  tracks = [],
  currentTime = 0,
  onSeek,
  onSelectClip,
  selectedClipId = null,
  /** (clip, edge:'start'|'end', newDurationSeconds, track). Fires once, on release. */
  onTrim,
  /** (clip, atSecondsFromClipStart, track). */
  onSplit,
  /** Sequential lane: (clip, toIndex, track). Placed lane: (clip, newStartSeconds, track). */
  onMoveClip,
  onDeleteClip,
  laneAppend,
  zoomStorageKey = null,
  snapStorageKey = null,
  emptyLabel = 'Nothing here yet.',
  className = '',
}) {
  const scroller = useRef(null);
  const innerRef = useRef(null);
  const [pps, setPps] = useState(() => {
    if (zoomStorageKey && typeof window !== 'undefined') {
      const n = parseFloat(window.localStorage.getItem(zoomStorageKey) || '');
      if (Number.isFinite(n)) return clamp(n, TL_MIN_PPS, TL_MAX_PPS);
    }
    return TL_DEFAULT_PPS;
  });
  const [snapping, setSnapping] = useState(() => (
    snapStorageKey && typeof window !== 'undefined'
      ? window.localStorage.getItem(snapStorageKey) !== '0' : true));
  /** The gesture in flight. A ref because pointer handlers must see it synchronously. */
  const gesture = useRef(null);
  /** What the gesture is doing right now: live preview geometry + annotation. */
  const [drag, setDrag] = useState(null);
  const anchor = useRef(null);

  const rows = useMemo(
    () => tracks.map((t) => ({ ...t, sequential: t.sequential !== false,
                               laid: layout(t.clips || [], pps, t.sequential !== false) })),
    [tracks, pps]);

  const contentSeconds = useMemo(() => {
    let end = 0;
    for (const t of rows) for (const l of t.laid) end = Math.max(end, l.t0 + l.w / pps);
    return end;
  }, [rows, pps]);

  /** Every clip edge, zero, and the playhead: what a drag snaps to. */
  const snapTimes = useMemo(() => {
    const out = [0, currentTime];
    for (const t of rows) for (const l of t.laid) { out.push(l.t0); out.push(l.t0 + l.w / pps); }
    return out;
  }, [rows, pps, currentTime]);

  /* ── zoom ─────────────────────────────────────────────────────────────────────────────────── */

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

  const fitPps = useCallback((seconds) => {
    const el = scroller.current;
    if (!el || !(seconds > 0)) return null;
    const room = el.clientWidth - TL_HEAD_W - 56;
    return room > 0 ? clamp(room / seconds, TL_MIN_PPS, TL_MAX_PPS) : null;
  }, []);

  const fit = useCallback(() => {
    const v = fitPps(contentSeconds);
    if (v !== null) { setPps(v); if (scroller.current) scroller.current.scrollLeft = 0; }
  }, [fitPps, contentSeconds]);

  // Fit ONCE, when there is first something to fit: a one-second clip at a fixed default is a
  // sliver that reads as a broken control. Once, not on every change — re-fitting under someone
  // who just zoomed is the control fighting them. A stored zoom wins; they chose it.
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
    const el = innerRef.current;
    if (!el) return 0;
    return Math.max(0, (clientX - el.getBoundingClientRect().left - TL_HEAD_W) / pps);
  }, [pps]);

  /* ── gestures ─────────────────────────────────────────────────────────────────────────────── */

  /** ONE pointer pipeline for scrub, trim and move. They differ in what they compute, not in how
   *  the press, the movement threshold, the listeners and the release are handled. Writing that
   *  three times is how one of them ends up without its cleanup and leaves the document mid-edit
   *  when the pointer goes up outside the window. */
  const beginGesture = useCallback((e, spec) => {
    e.preventDefault();
    e.stopPropagation();
    gesture.current = { ...spec, startX: e.clientX, active: false, value: null };
    const move = (ev) => {
      const cur = gesture.current;
      if (!cur) return;
      if (!cur.active && Math.abs(ev.clientX - cur.startX) < CLICK_SLOP) return;
      cur.active = true;
      let t = timeAt(ev.clientX);
      let guide = null;
      if (snapping && !ev.altKey && cur.kind !== 'scrub') {
        const r = snapTo(t, cur.snapTimes || snapTimes, TL_SNAP_PX / pps);
        t = r.value; guide = r.guide;
      }
      cur.value = t;
      if (cur.kind === 'scrub') onSeek?.(t);
      else setDrag(cur.preview ? { ...cur.preview(t), guide } : { guide });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('rui-tl-gesturing');
      const cur = gesture.current;
      gesture.current = null;
      setDrag(null);
      if (cur?.active && cur.value !== null) cur.commit?.(cur.value);
      else cur?.click?.();
    };
    document.body.classList.add('rui-tl-gesturing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [timeAt, snapping, snapTimes, pps, onSeek]);

  const onScrub = useCallback((e) => {
    if (!onSeek) return;
    onSeek(timeAt(e.clientX));
    beginGesture(e, { kind: 'scrub' });
  }, [onSeek, timeAt, beginGesture]);

  /* ── split ────────────────────────────────────────────────────────────────────────────────── */

  /** The clip the playhead is inside, far enough in that both halves would be legal. */
  const splitTarget = useMemo(() => {
    if (!onSplit) return null;
    for (const track of rows) {
      for (const l of track.laid) {
        if (!l.known) continue;
        if (currentTime > l.t0 + TL_MIN_CLIP_S && currentTime < l.t0 + l.clip.duration - TL_MIN_CLIP_S) {
          return { track, l };
        }
      }
    }
    return null;
  }, [rows, currentTime, onSplit]);

  const doSplit = useCallback(() => {
    if (!splitTarget) return;
    onSplit(splitTarget.l.clip, currentTime - splitTarget.l.t0, splitTarget.track);
  }, [splitTarget, currentTime, onSplit]);

  const selected = useMemo(() => {
    for (const track of rows) for (const l of track.laid) {
      if (l.clip.id === selectedClipId) return { track, l };
    }
    return null;
  }, [rows, selectedClipId]);

  const onKeyDown = useCallback((e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(pps * 1.35); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(pps / 1.35); }
    else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); doSplit(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && onDeleteClip) {
      e.preventDefault(); onDeleteClip(selected.l.clip, selected.track);
    }
  }, [pps, setZoom, doSplit, selected, onDeleteClip]);

  const toggleSnap = useCallback(() => {
    setSnapping((v) => {
      const next = !v;
      if (snapStorageKey && typeof window !== 'undefined') {
        try { window.localStorage.setItem(snapStorageKey, next ? '1' : '0'); } catch { /* ignore */ }
      }
      return next;
    });
  }, [snapStorageKey]);

  /* ── render ───────────────────────────────────────────────────────────────────────────────── */

  const major = majorTickStep(pps);
  const minor = major / 5;
  const laneW = Math.max(contentSeconds * pps + 140, 320);
  const ticks = [];
  for (let t = 0; t <= contentSeconds + major; t += major) ticks.push(t);

  return (
    <div className={`rui-tl ${className}`} onKeyDown={onKeyDown} tabIndex={0}>
      {/* ── toolbar ─────────────────────────────────────────────────────────────────────────
          The timeline's commands live in a bar, not in a pill floating over the lanes: chrome
          hovering in the corner of the content reads as debris. Every disabled control says WHY,
          because one that is off without a reason looks broken. */}
      <div className="rui-tl-bar">
        {onSplit && (
          <button type="button" className="rui-tl-btn" onClick={doSplit} disabled={!splitTarget}
                  title={splitTarget ? 'Split at the playhead (B)'
                    : 'Move the playhead inside a clip to split it'}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
            <span>Split</span>
          </button>
        )}
        {onDeleteClip && (
          <button type="button" className="rui-tl-btn" disabled={!selected}
                  onClick={() => selected && onDeleteClip(selected.l.clip, selected.track)}
                  title={selected ? 'Remove the selected clip' : 'Select a clip to remove it'}>
            Remove
          </button>
        )}
        <button type="button" className={`rui-tl-btn${snapping ? ' is-on' : ''}`}
                onClick={toggleSnap} aria-pressed={snapping}
                title="Snap to clip edges and the playhead. Hold Alt while dragging to bypass.">
          Snap
        </button>
        <span className="rui-tl-time" aria-label="Playhead position">{exactLabel(currentTime)}</span>
        <span className="rui-tl-spacer" />
        <button type="button" className="rui-tl-btn rui-tl-icon" onClick={() => setZoom(pps / 1.35)}
                disabled={pps <= TL_MIN_PPS + 1e-6} aria-label="Zoom out" title="Zoom out (−)">−</button>
        <button type="button" className="rui-tl-btn rui-tl-icon" onClick={() => setZoom(pps * 1.35)}
                disabled={pps >= TL_MAX_PPS - 1e-6} aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button type="button" className="rui-tl-btn" onClick={fit} disabled={!(contentSeconds > 0)}
                title="Fit the whole timeline in the panel">Fit</button>
      </div>

      <div className="rui-tl-scroll" ref={scroller}>
        <div className="rui-tl-inner" ref={innerRef} style={{ width: TL_HEAD_W + laneW }}>

          {/* ── ruler ──────────────────────────────────────────────────────────────────────── */}
          <div className="rui-tl-row rui-tl-rulerrow">
            <div className="rui-tl-head rui-tl-rulerhead" aria-hidden="true" />
            <div
              className="rui-tl-ruler"
              style={{
                width: laneW,
                // Minor ticks are a repeating background, not elements: ten minutes at a fine zoom
                // is thousands of nodes carrying no information a stripe does not.
                backgroundImage:
                  'linear-gradient(90deg, var(--uic-line, #DDDFE6) 0 1px, transparent 1px),'
                  + 'linear-gradient(90deg, var(--uic-line-soft, #EFF1F4) 0 1px, transparent 1px)',
                backgroundSize: `${major * pps}px 9px, ${minor * pps}px 5px`,
              }}
              onPointerDown={onScrub}
              role={onSeek ? 'slider' : undefined}
              aria-label={onSeek ? 'Playhead' : undefined}
              aria-valuemin={0} aria-valuemax={Math.round(contentSeconds)}
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

          {/* ── lanes ──────────────────────────────────────────────────────────────────────── */}
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
                {track.laid.map((l) => (
                  <Clip
                    key={l.clip.id ?? l.i}
                    l={l} track={track} pps={pps}
                    selected={selectedClipId === l.clip.id}
                    drag={drag}
                    onSelect={() => onSelectClip?.(l.clip, l.i)}
                    beginGesture={beginGesture}
                    onTrim={onTrim} onMoveClip={onMoveClip}
                    snapTimes={snapTimes}
                  />
                ))}
                {laneAppend && (
                  <span className="rui-tl-append"
                        style={{ left: track.laid.reduce((n, x) => Math.max(n, x.x + x.w), 0) + 6 }}>
                    {laneAppend(track)}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* A snap guide, drawn only while a gesture is actually locked onto something. */}
          {drag?.guide != null && (
            <div className="rui-tl-guide" style={{ left: TL_HEAD_W + drag.guide * pps }}
                 aria-hidden="true" />
          )}

          {Number.isFinite(currentTime) && (
            <div className="rui-tl-playhead" style={{ left: TL_HEAD_W + currentTime * pps }}
                 aria-hidden="true">
              <span className="rui-tl-playhead-grip" />
            </div>
          )}

          {/* Numbers where the gesture is, so a trim is read off the clip and not off the ruler. */}
          {drag?.annotation && (
            <div className="rui-tl-annot" style={{ left: TL_HEAD_W + (drag.annotAt || 0) * pps }}>
              {drag.annotation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── one clip ───────────────────────────────────────────────────────────────────────────────── */

function Clip({ l, track, pps, selected, drag, onSelect, beginGesture, onTrim, onMoveClip,
                snapTimes }) {
  const { clip, x, w, known, t0, i } = l;
  const live = drag?.clipId === clip.id ? drag : null;
  const width = live?.width ?? w;
  const left = live?.left ?? x;

  // A FIXED tile size, so zooming changes how many frames you see rather than stretching one.
  // That is the filmstrip convention; see the note at the top on these being one frame repeated.
  const tileW = Math.round((LANE_H - CLIP_INSET * 2) * (16 / 9));

  const startTrim = (e, edge) => {
    if (!onTrim || !known) return;
    beginGesture(e, {
      kind: 'trim',
      snapTimes,
      preview: (t) => {
        const dur = edge === 'end'
          ? clamp(t - t0, TL_MIN_CLIP_S, clip.duration)
          : clamp((t0 + clip.duration) - t, TL_MIN_CLIP_S, clip.duration);
        const nextW = dur * pps;
        const nextLeft = edge === 'end' ? x : x + (w - nextW);
        return { clipId: clip.id, width: nextW, left: nextLeft,
                 annotation: `${exactLabel(dur)} · ${edge === 'end' ? 'out' : 'in'}`,
                 annotAt: (nextLeft + nextW) / pps };
      },
      commit: (t) => {
        const dur = edge === 'end'
          ? clamp(t - t0, TL_MIN_CLIP_S, clip.duration)
          : clamp((t0 + clip.duration) - t, TL_MIN_CLIP_S, clip.duration);
        if (Math.abs(dur - clip.duration) > 1e-3) onTrim(clip, edge, dur, track);
      },
    });
  };

  const startMove = (e) => {
    if (!onMoveClip) { onSelect(); return; }
    const half = (known ? clip.duration : 0) / 2;
    beginGesture(e, {
      kind: 'move',
      snapTimes,
      preview: (t) => {
        const at = Math.max(0, t - half);
        return { clipId: clip.id, left: at * pps, annotation: exactLabel(at), annotAt: at };
      },
      commit: (t) => {
        const at = Math.max(0, t - half);
        if (track.sequential) {
          // On a cut, POSITION MEANS ORDER. Which slot the clip's centre landed in is the answer,
          // and reordering is what the host is asked for — "move this to 4.2s" is not a thing a
          // magnetic track can honour, and pretending otherwise puts the drawing and the document
          // out of step the moment it re-renders.
          let idx = 0;
          for (const other of track.laid) {
            if (other.clip.id === clip.id) continue;
            if (at + half > other.t0 + (other.w / pps) / 2) idx += 1;
          }
          if (idx !== i) onMoveClip(clip, idx, track);
        } else if (Math.abs(at - t0) > 1e-3) {
          onMoveClip(clip, at, track);
        }
      },
      click: onSelect,
    });
  };

  return (
    <article
      className={'rui-tl-clip'
        + (clip.state ? ` is-${clip.state}` : '')
        + (known ? '' : ' is-unmeasured')
        + (selected ? ' is-selected' : '')
        + (live ? ' is-live' : '')}
      style={{ left, width, ...(clip.accent ? { '--rui-tl-accent': clip.accent } : null) }}
      title={clip.title || clip.label}
      tabIndex={0}
      onPointerDown={startMove}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      {/* A poster tiles as a strip. With no poster but a playable file, the FILE's own first
          frame is shown — `preload="metadata"` paints it without fetching the whole clip, and it
          is a real frame of the real thing rather than a stand-in. Only when there is neither
          does the block fall back to a glyph, which claims nothing. */}
      {clip.poster ? (
        <span className="rui-tl-strip" style={{
          backgroundImage: `url("${String(clip.poster).replace(/"/g, '\\"')}")`,
          backgroundSize: `${tileW}px 100%`,
        }} />
      ) : clip.video ? (
        <video className="rui-tl-frame" src={clip.video} preload="metadata" muted playsInline
               tabIndex={-1} aria-hidden="true" />
      ) : (
        <span className="rui-tl-blank" aria-hidden="true">{clip.glyph}</span>
      )}

      {clip.badge && <span className="rui-tl-badge">{clip.badge}</span>}
      {known && width > 46 && <span className="rui-tl-dur">{durationLabel(clip.duration)}</span>}
      {clip.label && width > 104 && <span className="rui-tl-name">{clip.label}</span>}

      {/* Trim handles, only on a measured clip: there is nothing to trim against a length nobody
          knows, and offering the gesture anyway would conjure a duration out of a drag. */}
      {onTrim && known && (
        <>
          <span className="rui-tl-trim l" onPointerDown={(e) => startTrim(e, 'start')}
                role="separator" aria-label={`Trim the start of ${clip.label || 'this clip'}`} />
          <span className="rui-tl-trim r" onPointerDown={(e) => startTrim(e, 'end')}
                role="separator" aria-label={`Trim the end of ${clip.label || 'this clip'}`} />
        </>
      )}
    </article>
  );
}
