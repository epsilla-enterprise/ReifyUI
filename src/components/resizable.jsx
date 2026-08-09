// Drag-to-resize pane primitive — drag mechanics lifted from HarnessRouter's workbench
// useHResize (iframe/text-selection neutralization included), extended with:
//   - min/max clamps (absolute px and/or a viewport fraction, e.g. 60vw)
//   - per-user width persistence (localStorage, storageKey)
//   - double-click the divider to reset to the default width
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
    fromRight = false,    // divider sits on the pane's LEFT edge (dragging right shrinks)
    storageKey = null,    // persist the chosen width per user (localStorage)
  } = opts;

  const clamp = useCallback((x) => {
    let hi = max ?? Infinity;
    if (maxFraction && typeof window !== 'undefined') hi = Math.min(hi, Math.round(window.innerWidth * maxFraction));
    return Math.min(hi, Math.max(min, x));
  }, [min, max, maxFraction]);

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
    const sx = e.clientX, base = widthRef.current, dir = fromRight ? -1 : 1;
    // While dragging, neutralize iframes/text-selection so an embedded preview can't swallow
    // mousemove/mouseup (which would strand the drag).
    document.body.classList.add('uic-resizing');
    const move = (ev) => setWidth(clamp(base + dir * (ev.clientX - sx)));
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      document.body.style.cursor = ''; document.body.classList.remove('uic-resizing');
      persist(widthRef.current);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  }, [clamp, fromRight, persist]);

  const reset = useCallback(() => {
    setWidth(initial);
    if (storageKey) { try { window.localStorage.removeItem(storageKey); } catch { /* private mode */ } }
  }, [initial, storageKey]);

  return { width, onMouseDown, reset };
}

/** The grabbable divider (comfortable 7px hit area, col-resize cursor, dblclick = reset). */
export function PaneResizer(props) {
  const { pane, className, title = 'Drag to resize (double-click to reset)' } = props;
  return (
    <div
      className={className ?? 'uic-vresize'}
      role="separator"
      aria-orientation="vertical"
      title={title}
      onMouseDown={pane.onMouseDown}
      onDoubleClick={pane.reset}
    />
  );
}
