// Modal — a dialog whose body is yours: a preview, a big form, a comparison.
//
// useDialog() answers a QUESTION and resolves to a value (confirm/prompt/alert). This is the
// other half: a surface with arbitrary content that the caller opens and closes itself. Products
// were re-implementing it per feature, each with its own backdrop mousedown handler and its own
// document keydown listener.
//
// It shares the dialog host's Escape ordering through the package's overlay stack (components/
// overlay.js), so a Modal opened on top of a confirm takes the key and the confirm does not, and
// both sit at the same z-index layer (--uic-z-overlay). It does NOT render inside DialogHost's
// portal: that root is created from the host's private state and only exists while a dialog is
// open, so there is nothing to render into and no API to reach it with. One stack, two roots, is
// the honest arrangement — and it means Modal works in an app that never mounted DialogHost.
import React, { useCallback, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { IcX } from './icons.jsx';
import { useOverlayEscape } from './overlay.js';

/**
 * open        render it
 * onClose     Escape, the ✕, or a click on the backdrop itself
 * title       the heading (string or node); also names the dialog for assistive tech
 * description one quiet line under the title
 * actions     buttons in the header, before the ✕ (e.g. "Use this template")
 * size        'sm' | 'md' | 'lg' | 'full' — or pass `width` for an exact px/any CSS width
 * labelledBy  id of your own heading, when `title` is not where the name lives
 */
export function Modal(props) {
  const { open, onClose, title, description, actions, size = 'md', width,
          labelledBy, children, classNames = {} } = props;
  const titleId = useId();

  const escape = useCallback(() => onClose?.(), [onClose]);
  useOverlayEscape(open, escape);

  // A modal that leaves the page scrolling behind it drifts under the reader's fingers on a
  // touch device and loses their place in the list they opened it from.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  // mousedown, not click: a press that STARTED inside the card and ended on the backdrop (a drag
  // that overshot, a text selection) would otherwise close it out from under the person.
  const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose?.(); };
  return createPortal(
    <div className={['uic-modal-backdrop', classNames.backdrop || ''].filter(Boolean).join(' ')}
         onMouseDown={onBackdrop}>
      <div className={['uic-modal', `is-${size}`, classNames.root || ''].filter(Boolean).join(' ')}
           style={width ? { width } : undefined}
           role="dialog" aria-modal="true"
           aria-labelledby={labelledBy || (title ? titleId : undefined)}>
        {(title || actions) ? (
          <div className="uic-modal-h">
            <div className="uic-modal-title">
              {title ? <h3 id={titleId}>{title}</h3> : null}
              {description ? <p>{description}</p> : null}
            </div>
            {actions}
            <button type="button" className="uic-modal-x" aria-label="Close" onClick={onClose}>
              <IcX size={18} />
            </button>
          </div>
        ) : null}
        <div className={['uic-modal-b', classNames.body || ''].filter(Boolean).join(' ')}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
