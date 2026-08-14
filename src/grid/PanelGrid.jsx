// PanelGrid — a column grid of panels you can drag and resize, and a read-only mode that is the
// default. The layout is a prop: this component never owns it, it proposes the next one.
//
// Written here rather than taken from react-grid-layout on purpose. What a dashboard needs is
// this file: cells → pixels, a pointer drag, a resize corner, and gravity. What the dependency
// adds around that is three more packages (draggable / resizable / a deep-equal), a stylesheet
// with its own hardcoded colours (its drop placeholder is literally `background: red`), and no
// keyboard path at all. It is also not a peer any host here already owns, so every app that
// imports a Button would pay for it. The subset below has no dependencies, themes from the same
// --uic-* tokens as everything else, and arranges a panel from the keyboard.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { compact, layoutRows, moveItem, nudgeItem, resizeItem, sameLayout, sortLayout } from './layout.js';

/** Measure the box we actually get. A grid inside a scroller that also holds a side panel gets a
 *  stale width from anything that measures once — the observer reports every change. */
function useMeasuredWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// A press that lands on one of these is that control's press, not the start of a drag.
const NO_DRAG = 'button, a, input, select, textarea, [data-uic-nodrag]';

/**
 * layout       [{i, x, y, w, h, minW?, minH?, maxW?, maxH?, static?}] — cells, not pixels
 * children     one element per layout entry, matched by `key`
 * cols         columns across the full width (12)
 * rowHeight    px per row (40)
 * gap          px between cells (12)
 * editable     false (default): nothing drags, nothing resizes, no handle is drawn
 * dragHandle   selector a press must land inside to start a move ('.uic-panel-head')
 * stackAt      below this container width the grid becomes ONE column in layout order and stops
 *              being arrangeable — twelve columns across a phone is 32px each, and dragging a
 *              panel between two cells nobody can see is not an interaction worth keeping
 * resizeLabel  (id) => the handle's accessible name; name the panel in it
 * onLayoutChange(next)  fires ONCE per interaction, on release — not per pixel, because the host
 *              is usually writing the result to a document
 */
export function PanelGrid(props) {
  const {
    layout = [], children, cols = 12, rowHeight = 40, gap = 12,
    editable = false, dragHandle = '.uic-panel-head', stackAt = 640,
    onLayoutChange, resizeLabel, className = '',
  } = props;

  const [wrapRef, width] = useMeasuredWidth();
  // {id, mode, origin, px, py, dx, dy, preview} while a pointer interaction is live, else null.
  // The ref is what the pointer handlers read and write (they run between renders); the state is
  // the same value, kept only so React redraws.
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  // A drag ends in a click on whatever was under the pointer. Swallow exactly that one.
  const swallowClick = useRef(false);

  const stacked = width > 0 && width < stackAt;
  const arrangeable = editable && !stacked;
  const live = drag ? drag.preview : layout;

  const colW = width > 0 ? (width - gap * (cols - 1)) / cols : 0;
  const cellW = colW + gap;
  const cellH = rowHeight + gap;
  const rowsToPx = (h) => h * rowHeight + (h - 1) * gap;

  // Stacked: one column, in reading order, each panel keeping its own height.
  const stack = useMemo(() => {
    if (!stacked) return null;
    const tops = new Map();
    let y = 0;
    for (const it of sortLayout(live)) {
      tops.set(it.i, y);
      y += rowsToPx(it.h || 1) + gap;
    }
    return { tops, height: Math.max(0, y - gap) };
  }, [stacked, live, rowHeight, gap]);

  const rows = layoutRows(live);
  const height = stacked ? stack.height : (rows ? rowsToPx(rows) : 0);

  const commit = useCallback((next) => {
    if (onLayoutChange && !sameLayout(next, layout)) onLayoutChange(next);
  }, [onLayoutChange, layout]);

  // ── pointer interaction ───────────────────────────────────────────────────
  // The listeners go on in the pointerdown handler itself, NOT in an effect keyed on the drag
  // state: an effect runs after React has re-rendered, and every pointer move that arrived in
  // between is simply gone. A quick flick then moves nothing at all.
  const detach = useRef(null);
  useEffect(() => () => detach.current?.(), []);          // a drag must not outlive the grid

  const start = (id, mode) => (e) => {
    if (!arrangeable || e.button !== 0) return;
    const item = layout.find((it) => it.i === id);
    if (!item || item.static) return;
    if (mode === 'move' && (!e.target.closest(dragHandle) || e.target.closest(NO_DRAG))) return;
    e.preventDefault();
    detach.current?.();
    const begin = { id, mode, origin: item, px: e.clientX, py: e.clientY, dx: 0, dy: 0, preview: layout };
    dragRef.current = begin;
    setDrag(begin);

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.px;
      const dy = ev.clientY - d.py;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) swallowClick.current = true;
      const cx = Math.round(dx / cellW);
      const cy = Math.round(dy / cellH);
      const preview = d.mode === 'move'
        ? moveItem(layout, d.id, d.origin.x + cx, d.origin.y + cy, cols)
        : resizeItem(layout, d.id, d.origin.w + cx, d.origin.h + cy, cols);
      dragRef.current = { ...d, dx, dy, preview };
      setDrag(dragRef.current);
    };
    const end = (commitIt) => () => {
      const d = dragRef.current;
      dragRef.current = null;
      off();
      setDrag(null);
      if (d && commitIt) commit(d.preview);
    };
    const onUp = end(true);
    // Escape abandons the interaction: the preview is dropped and nothing is committed.
    const onKey = (ev) => { if (ev.key === 'Escape') end(false)(); };
    function off() {
      detach.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    }
    detach.current = off;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
  };

  const onClickCapture = (e) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  // ── keyboard interaction ──────────────────────────────────────────────────
  // The same handle answers arrows (resize) and shift+arrows (move): a panel that can only be
  // arranged by dragging cannot be arranged by everyone.
  const onHandleKey = (id) => (e) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    const item = layout.find((it) => it.i === id);
    if (!item) return;
    e.preventDefault();
    commit(e.shiftKey
      ? nudgeItem(layout, id, step[0], step[1], cols)
      : resizeItem(layout, id, item.w + step[0], item.h + step[1], cols));
  };

  const boxOf = (it) => (stacked
    ? { left: 0, top: stack.tops.get(it.i), width, height: rowsToPx(it.h || 1) }
    : { left: it.x * cellW, top: it.y * cellH, width: it.w * colW + (it.w - 1) * gap, height: rowsToPx(it.h) });

  const byId = new Map(live.map((it) => [it.i, it]));
  const ghost = drag && drag.mode === 'move' && byId.has(drag.id) ? boxOf(byId.get(drag.id)) : null;
  const cls = ['uic-pg', arrangeable ? 'is-editable' : '', stacked ? 'is-stacked' : '', className]
    .filter(Boolean).join(' ');

  return (
    <div
      ref={wrapRef}
      className={cls}
      style={{ height }}
      onClickCapture={onClickCapture}
      // A cancelled pointer (a phone call, a lost pointer capture) leaves no click to swallow.
      // Clearing on the next press means a stale flag can never eat someone else's click.
      onPointerDownCapture={() => { swallowClick.current = false; }}
    >
      {ghost ? <div className="uic-pg-ghost" aria-hidden="true" style={ghost} /> : null}
      {width > 0 && React.Children.map(children, (child) => {
        if (!React.isValidElement(child) || child.key == null) return null;
        const id = String(child.key).replace(/^\.\$/, '');
        const it = byId.get(id);
        if (!it) return null;                       // no cell for this child: nowhere to put it
        const moving = drag && drag.id === id;
        // While moving, the panel follows the pointer in pixels and the ghost marks the cell it
        // would land in; a resize snaps, so the corner never lags the pointer's own cell.
        const offset = moving && drag.mode === 'move'
          ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : null;
        return (
          <div
            className={'uic-pg-item' + (moving ? ' is-moving' : '')}
            style={{ ...boxOf(it), ...offset }}
            onPointerDown={arrangeable ? start(id, 'move') : undefined}
          >
            {child}
            {arrangeable && !it.static ? (
              <button
                type="button"
                className="uic-pg-handle"
                aria-label={resizeLabel ? resizeLabel(id) : 'Resize panel. Arrow keys resize it; shift with arrow keys moves it past its neighbours.'}
                onPointerDown={start(id, 'resize')}
                onKeyDown={onHandleKey(id)}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M9 1v8H1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Gravity applied to a layout you built yourself. A new panel added with `y: Infinity` lands at
 *  the bottom; this is what turns that into a real row. */
export function packLayout(layout, cols = 12) {
  const bottom = layoutRows(layout.filter((it) => Number.isFinite(it.y)));
  return compact(layout.map((it) => (Number.isFinite(it.y) ? it : { ...it, y: bottom })), cols);
}
