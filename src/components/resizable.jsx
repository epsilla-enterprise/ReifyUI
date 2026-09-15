// Drag-to-resize pane primitive — drag mechanics lifted from HarnessRouter's workbench
// useHResize (iframe/text-selection neutralization included), extended with:
//   - min/max clamps (absolute px and/or a viewport fraction, e.g. 60vw)
//   - per-user width persistence (localStorage, storageKey)
//   - double-click the divider to reset to the default width
//   - axis: 'x' (default, side-by-side panes) or 'y' (stacked panes, e.g. an artifact preview
//     under a narrow chat column, where splitting sideways would leave neither half readable)
//
// Usage:
//   const pane = useResizablePane({ initial: 340, min: 320, maxFraction: 0.6,
//                                   fromRight: true, storageKey: 'cg.chat.w' });
//   <PaneResizer pane={pane} />
//   <aside style={{ flex: `0 0 ${pane.width}px` }}>…</aside>
import React, { useCallback, useRef, useState } from 'react';

export function useResizablePane(opts = {}) {
  const {
    initial = 380,
    min = 240,
    max = null,           // absolute px cap (null = none)
    maxFraction = null,   // viewport-width fraction cap, e.g. 0.6 for 60vw (null = none)
    fromRight = false,    // divider sits on the pane's LEFT/TOP edge (dragging toward it shrinks)
    storageKey = null,    // persist the chosen size per user (localStorage)
    axis = 'x',           // 'x' = width (col-resize), 'y' = height (row-resize)
  } = opts;
  const vertical = axis === 'y';
  // One clamp, one drag, one persistence path for both orientations: the axis only decides which
  // pointer coordinate and which viewport dimension are read.
  const coord = (e) => (vertical ? e.clientY : e.clientX);
  const viewportExtent = () => (typeof window === 'undefined' ? 0 : (vertical ? window.innerHeight : window.innerWidth));
  const cursor = vertical ? 'row-resize' : 'col-resize';

  const clamp = useCallback((x) => {
    let hi = max ?? Infinity;
    if (maxFraction && typeof window !== 'undefined') hi = Math.min(hi, Math.round(viewportExtent() * maxFraction));
    return Math.min(hi, Math.max(min, x));
  }, [min, max, maxFraction, vertical]); // eslint-disable-line react-hooks/exhaustive-deps

  const [width, setWidth] = useState(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const n = parseInt(window.localStorage.getItem(storageKey) || '', 10);
        if (Number.isFinite(n)) return clamp(n);
      } catch { /* private mode */ }
    }
    return initial;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const persist = useCallback((w) => {
    if (!storageKey) return;
    try { window.localStorage.setItem(storageKey, String(w)); } catch { /* private mode */ }
  }, [storageKey]);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const sx = coord(e), base = widthRef.current, dir = fromRight ? -1 : 1;
    // While dragging, neutralize iframes/text-selection so an embedded preview can't swallow
    // mousemove/mouseup (which would strand the drag).
    document.body.classList.add('uic-resizing');
    const move = (ev) => setWidth(clamp(base + dir * (coord(ev) - sx)));
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      document.body.style.cursor = ''; document.body.classList.remove('uic-resizing');
      persist(widthRef.current);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    document.body.style.cursor = cursor;
  }, [clamp, fromRight, persist, vertical]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch / pen drags (pointer events). Mouse keeps the mousedown path above
  // untouched — this handler ignores mouse pointers so the two never double up.
  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const sx = coord(e), base = widthRef.current, dir = fromRight ? -1 : 1;
    const el = e.currentTarget;
    document.body.classList.add('uic-resizing');
    try { el.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    const move = (ev) => setWidth(clamp(base + dir * (coord(ev) - sx)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.classList.remove('uic-resizing');
      persist(widthRef.current);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }, [clamp, fromRight, persist, vertical]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard resizing: move the pane edge by a signed px delta (clamped,
  // persisted). Positive delta = wider pane.
  const nudge = useCallback((delta) => {
    const w = clamp(widthRef.current + delta);
    setWidth(w);
    persist(w);
  }, [clamp, persist]);

  const reset = useCallback(() => {
    setWidth(initial);
    if (storageKey) { try { window.localStorage.removeItem(storageKey); } catch { /* private mode */ } }
  }, [initial, storageKey]);

  // Resolved clamp bounds for aria-valuemin/max on the divider.
  let maxResolved = max ?? null;
  if (maxFraction && typeof window !== 'undefined') {
    const frac = Math.round(viewportExtent() * maxFraction);
    maxResolved = maxResolved == null ? frac : Math.min(maxResolved, frac);
  }

  return { width, onMouseDown, onPointerDown, nudge, reset, min, max: maxResolved, fromRight, axis };
}

/** The grabbable divider (comfortable 7px hit area, col-resize cursor, dblclick = reset).
 *  Keyboard: focus it (Tab) and use ArrowLeft/ArrowRight to move the divider
 *  in 24px steps (Shift for 96px); touch drags work through pointer events.
 *  Mouse drag and double-click reset behave exactly as before. */
export function PaneResizer(props) {
  const { pane, className, title = 'Drag to resize (double-click to reset)' } = props;
  const vertical = pane.axis === 'y';
  const onKeyDown = (e) => {
    const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (!keys.includes(e.key)) return;
    if (!pane.nudge) return;
    e.preventDefault();
    const step = e.shiftKey ? 96 : 24;
    // Arrows move the SEPARATOR: for a trailing pane (divider on its leading
    // edge) the forward key shrinks the pane; for a leading pane it grows it.
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const dir = (forward ? 1 : -1) * (pane.fromRight ? -1 : 1);
    pane.nudge(dir * step);
  };
  return (
    <div
      className={className ?? (vertical ? 'uic-hresize' : 'uic-vresize')}
      role="separator"
      // The separator's own orientation: a stacked (axis 'y') split is divided by a HORIZONTAL bar.
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={title}
      aria-valuenow={Math.round(pane.width)}
      aria-valuemin={pane.min != null ? Math.round(pane.min) : undefined}
      aria-valuemax={pane.max != null ? Math.round(pane.max) : undefined}
      tabIndex={0}
      title={title}
      onMouseDown={pane.onMouseDown}
      onPointerDown={pane.onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={pane.reset}
    />
  );
}
