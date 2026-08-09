// EditorCanvas — direct manipulation over the deck renderer: a real slides
// editor. One transparent interaction layer above the scaled SlideStage owns
// ALL pointer behavior (hit-test → select, click-drag moves immediately like
// Google Slides, corner handles resize, double-click edits text inline,
// Delete removes, arrows nudge). It never mutates the deck itself — every
// commit flows up as a typed patch (onPatchElement/onDeleteElement), so the
// host owns undo/autosave/collab broadcast. Peer decorations (selection
// outlines, live drag) render from the `peers` prop.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideStage } from './SlideView.jsx';

const STAGE_W = 1920;
const STAGE_H = 1080;
const MIN_SIZE = 24;

// Topmost element whose frame contains the stage-space point (z = list order).
// Rotation is ignored for hit-testing (rare, and the frame box stays close).
function hitTest(slide, x, y) {
  const els = slide?.elements || [];
  for (let i = els.length - 1; i >= 0; i--) {
    const f = els[i].frame || {};
    if (x >= (f.x || 0) && x <= (f.x || 0) + (f.w || 0)
      && y >= (f.y || 0) && y <= (f.y || 0) + (f.h || 0)) return els[i];
  }
  return null;
}

const HANDLES = [
  { k: 'nw', cx: 0, cy: 0 }, { k: 'ne', cx: 1, cy: 0 },
  { k: 'sw', cx: 0, cy: 1 }, { k: 'se', cx: 1, cy: 1 },
];

function resizeFrame(f0, k, dx, dy) {
  let { x, y, w, h } = f0;
  if (k.includes('e')) w = Math.max(MIN_SIZE, f0.w + dx);
  if (k.includes('s')) h = Math.max(MIN_SIZE, f0.h + dy);
  if (k.includes('w')) { const nw = Math.max(MIN_SIZE, f0.w - dx); x = f0.x + (f0.w - nw); w = nw; }
  if (k.includes('n')) { const nh = Math.max(MIN_SIZE, f0.h - dy); y = f0.y + (f0.h - nh); h = nh; }
  return { ...f0, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function textOf(el) {
  return (el.content?.runs || []).map((r) => r.text ?? '').join('\n');
}

export function EditorCanvas({
  slide, theme, resolveSrc,
  selectedId, onSelect,
  onPatchElement,           // (elementId, patch, {transient}) => void
  onDeleteElement,          // (elementId) => void
  onDragState,              // (elementId|null, frame|null) live broadcast hook
  peers = [],               // [{id,name,color,sel:{slideId,elId},drag:{elId,frame}}]
  readOnly = false,
}) {
  const boxRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [box, setBox] = useState({ left: 0, top: 0 });
  const gestureRef = useRef(null);              // {mode:'move'|'resize', handle, el, f0, sx, sy, moved}
  const [liveFrame, setLiveFrame] = useState(null);   // frame during an active gesture
  const [editing, setEditing] = useState(null); // {elId, value}

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) {
        const s = Math.min(r.width / STAGE_W, r.height / STAGE_H);
        setScale(s);
        setBox({ left: (r.width - STAGE_W * s) / 2, top: (r.height - STAGE_H * s) / 2 });
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toStage = useCallback((e) => {
    const r = boxRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left - box.left) / scale, y: (e.clientY - r.top - box.top) / scale };
  }, [scale, box]);

  const selected = (slide?.elements || []).find((el) => el.id === selectedId) || null;

  function beginGesture(mode, el, e, handle) {
    if (readOnly) return;
    const p = toStage(e);
    gestureRef.current = { mode, handle, el, f0: { ...el.frame }, sx: p.x, sy: p.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onLayerPointerDown(e) {
    if (editing) return;                     // let the textarea own the pointer
    const p = toStage(e);
    const hit = hitTest(slide, p.x, p.y);
    onSelect?.(hit ? hit.id : null);
    if (hit) beginGesture('move', hit, e);
  }

  function onPointerMove(e) {
    const g = gestureRef.current;
    if (!g) return;
    const p = toStage(e);
    const dx = Math.round(p.x - g.sx);
    const dy = Math.round(p.y - g.sy);
    if (!g.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;   // click, not drag
    g.moved = true;
    const f = g.mode === 'move'
      ? { ...g.f0,
          x: Math.max(-g.f0.w + 40, Math.min(STAGE_W - 40, g.f0.x + dx)),
          y: Math.max(-g.f0.h + 40, Math.min(STAGE_H - 40, g.f0.y + dy)) }
      : resizeFrame(g.f0, g.handle, dx, dy);
    setLiveFrame(f);
    onDragState?.(g.el.id, f);
  }

  function onPointerUp() {
    const g = gestureRef.current;
    gestureRef.current = null;
    onDragState?.(null, null);
    if (g && g.moved && liveFrame) onPatchElement?.(g.el.id, { frame: liveFrame });
    setLiveFrame(null);
  }

  function onDoubleClick(e) {
    if (readOnly) return;
    const p = toStage(e);
    const hit = hitTest(slide, p.x, p.y);
    if (hit && hit.type === 'text') {
      onSelect?.(hit.id);
      setEditing({ elId: hit.id, value: textOf(hit) });
    }
  }

  // Delete + nudge on the selected element (never while typing in the editor
  // overlay — it stops propagation itself).
  useEffect(() => {
    if (readOnly) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!selected) return;
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onDeleteElement?.(selected.id); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 24 : 4;
        const f = { ...selected.frame };
        if (e.key === 'ArrowLeft') f.x -= step;
        if (e.key === 'ArrowRight') f.x += step;
        if (e.key === 'ArrowUp') f.y -= step;
        if (e.key === 'ArrowDown') f.y += step;
        onPatchElement?.(selected.id, { frame: f });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, readOnly, onPatchElement, onDeleteElement]);

  function commitText() {
    if (!editing) return;
    const el = (slide?.elements || []).find((x) => x.id === editing.elId);
    if (el && editing.value !== textOf(el)) {
      const runs = editing.value.split('\n').map((t) => ({ text: t }));
      onPatchElement?.(el.id, { content: { ...el.content, runs } });
    }
    setEditing(null);
  }

  // Render-time frame override for the element being dragged/resized.
  const displaySlide = liveFrame && gestureRef.current
    ? { ...slide,
        elements: (slide.elements || []).map((el) => (el.id === gestureRef.current.el.id ? { ...el, frame: liveFrame } : el)) }
    : slide;

  const selFrame = liveFrame && gestureRef.current && selected && gestureRef.current.el.id === selected.id
    ? liveFrame : selected?.frame;

  const editingEl = editing ? (slide?.elements || []).find((x) => x.id === editing.elId) : null;

  return (
    <div ref={boxRef} className="sl-editor-fit" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ position: 'absolute', left: box.left, top: box.top,
                    width: STAGE_W * scale, height: STAGE_H * scale,
                    boxShadow: '0 8px 40px -8px rgba(15,23,42,.25)', borderRadius: 6 * scale, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <SlideStage slide={displaySlide} theme={theme} resolveSrc={resolveSrc} />
        </div>
      </div>

      {/* interaction + decoration layer (stage coordinates * scale) */}
      <div className="sl-editor-layer"
           style={{ position: 'absolute', left: box.left, top: box.top,
                    width: STAGE_W * scale, height: STAGE_H * scale, touchAction: 'none' }}
           onPointerDown={onLayerPointerDown} onPointerMove={onPointerMove}
           onPointerUp={onPointerUp} onDoubleClick={onDoubleClick}>

        {/* peer selections + live peer drags */}
        {peers.map((p) => {
          const targetId = p.drag?.elId || p.sel?.elId;
          if (!targetId || p.sel?.slideId !== slide?.id) return null;
          const el = (slide?.elements || []).find((x) => x.id === targetId);
          const f = p.drag?.frame || el?.frame;
          if (!f) return null;
          return (
            <div key={p.id} className="sl-peer-box" style={{
              left: f.x * scale, top: f.y * scale, width: f.w * scale, height: f.h * scale,
              borderColor: p.color }}>
              <span className="sl-peer-tag" style={{ background: p.color }}>{p.name}</span>
            </div>
          );
        })}

        {/* own selection + handles */}
        {selected && selFrame && !editing && (
          <div className="sl-sel-box" style={{ left: selFrame.x * scale, top: selFrame.y * scale,
                                               width: selFrame.w * scale, height: selFrame.h * scale }}>
            {!readOnly && HANDLES.map((h) => (
              <span key={h.k} className={`sl-sel-handle sl-h-${h.k}`}
                    onPointerDown={(e) => { e.stopPropagation(); beginGesture('resize', selected, e, h.k); }} />
            ))}
          </div>
        )}

        {/* inline text editor */}
        {editingEl && (
          <textarea className="sl-text-edit" autoFocus value={editing.value}
                    style={{ left: editingEl.frame.x * scale, top: editingEl.frame.y * scale,
                             width: editingEl.frame.w * scale, height: editingEl.frame.h * scale,
                             fontSize: (editingEl.style?.fontSize
                               || { title: 72, subtitle: 36, body: 30, bullets: 30, caption: 22 }[editingEl.content?.role || 'body']) * scale,
                             fontFamily: 'var(--sl-body, inherit)', lineHeight: 1.25,
                             textAlign: editingEl.style?.align || 'left' }}
                    onChange={(e) => setEditing((v) => ({ ...v, value: e.target.value }))}
                    onBlur={commitText}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') setEditing(null);
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitText();
                    }} />
        )}
      </div>
    </div>
  );
}
