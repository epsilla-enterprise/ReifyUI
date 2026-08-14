// Popover — a panel anchored to a control: a menu, a picker, a row's overflow actions.
//
// Ten of these were hand-rolled across four apps, each with its own mousedown-outside listener,
// and exactly ONE of the ten survived a 390px viewport: the other nine positioned themselves with
// `position: absolute; bottom: 36px` and either ran off the screen or grew taller than it. That
// one implementation's placement logic is what this component is, so placement is built IN and
// is not separately exportable — a hook you can skip is how you ship the other nine again.
//
// It portals to the body and positions itself `fixed`, so it is never clipped by an ancestor's
// overflow (the reason the absolute ones lived inside their own scroll containers).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayEscape } from './overlay.js';

const GAP = 6;       // between the anchor and the panel
const MARGIN = 8;    // minimum clearance from the viewport edge

/**
 * open       render it
 * anchorRef  ref to the control it belongs to; the panel positions against its box
 * onClose    Escape, an outside pointerdown, or the caller's own reason
 * width      preferred width; clamped to the viewport
 * minHeight  never squeeze below this — flip to the other side instead
 * placement  'auto' (default) picks the side with more room; 'above'/'below' force one
 */
export function Popover(props) {
  const { open, anchorRef, onClose, width = 280, minHeight = 140, placement = 'auto',
          children, className, label } = props;
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const el = anchorRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width, vw - MARGIN * 2);
      const below = vh - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      const up = placement === 'above'
        || (placement === 'auto' && below < minHeight && above > below);
      const maxHeight = Math.max(minHeight, Math.floor(up ? above : below));
      const left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN));
      setPos(up
        ? { left, bottom: Math.round(vh - r.top + GAP), width: w, maxHeight }
        : { left, top: Math.round(r.bottom + GAP), width: w, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    // Capture phase: the anchor is usually inside a scrolling pane, and a scroll event on that
    // pane does not bubble to the window.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, width, minHeight, placement]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target)) return;
      // The anchor closes it through its own onClick; treating the press as "outside" here would
      // close and immediately reopen it.
      if (anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, anchorRef, onClose]);

  const escape = useCallback(() => onClose?.(), [onClose]);
  useOverlayEscape(open, escape);

  if (!open || !pos || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={popRef} className={['uic-pop', className || ''].filter(Boolean).join(' ')}
         style={pos} role="dialog" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}
