// Composer — extracted from HarnessRouter's workbench composer (textarea + bottom action row).
// Enter sends (Shift+Enter for a newline). Auto-grows to fit content, capped at maxRows, then
// scrolls (HR behavior; pass autoGrow={false} for a fixed-height textarea).
//
// Slots:
//   attachments        node rendered ABOVE the textarea (attachment card row)
//   accessoriesLeft    nodes before the flexible spacer (attach button, model select, mic, …)
//   accessoriesRight   nodes after the spacer, before the send button
//   renderSend()       replaces the default send button entirely
//   inline             single-line layout: accessories, textarea and send share ONE row,
//                      vertically aligned (the classic chat input). Buttons stick to the
//                      bottom edge as the textarea grows, so multiline still reads right.
//   tray               node rendered INSIDE the card, under the action row — one seamless
//                      surface, no divider band. This is where a product puts the row that
//                      belongs to the message being composed (Arena's harness+model chips,
//                      a template picker, a recipient list) rather than to the app chrome.
//   classNames         { root, input, row } — each REPLACES the default class when provided,
//                      so a product can restyle wholesale without fighting the package CSS
//
// NOTE: autoGrow and a CSS-driven min-height on the textarea are mutually exclusive — autoGrow
// writes an explicit height on every keystroke, which the min-height then cannot raise. A fixed
// multi-line box wants autoGrow={false} + rows.
import React, { useEffect, useRef } from 'react';
import { IcSend } from './icons.jsx';

// Takes a single `props` object (destructured inside) so TSX consumers don't infer every slot
// as required.
export function Composer(props) {
  const {
    value,
    onChange,
    onSend,
    disabled = false,
    sendDisabled,
    placeholder,
    rows = 1,
    autoGrow = true,
    inline = false,
    maxRows = 15,
    autoFocus,
    // The composer on a landing page often has an ANIMATING placeholder (a typewriter cycling
    // through example prompts), and a placeholder is the textarea's only accessible name unless
    // one is given — so the field announces a different name every few seconds.
    inputAriaLabel,
    attachments,
    tray,
    accessoriesLeft,
    accessoriesRight,
    renderSend,
    classNames = {},
    inputRef,
  } = props;
  const ownRef = useRef(null);
  const taRef = inputRef || ownRef;

  // Auto-grow the composer to fit its content, capped at ~maxRows rows (then it scrolls).
  useEffect(() => {
    if (!autoGrow) return;
    const el = taRef.current; if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 21;
    const max = lh * maxRows + parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0');
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, autoGrow, maxRows, taRef]);

  const sendEl = renderSend ? renderSend() : (
    <button type="button" className="uic-send" disabled={sendDisabled} onClick={() => onSend()} aria-label="Send message">
      <IcSend />
    </button>
  );

  if (inline) {
    return (
      <div className={classNames.root ?? 'wbx-composer'}>
        {attachments}
        <div className="uic-composer-line">
          {accessoriesLeft}
          <textarea
            ref={taRef}
            className={classNames.input ?? 'wbx-composer-input'}
            rows={rows}
            value={value}
            placeholder={placeholder}
            aria-label={inputAriaLabel || placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
          />
          {accessoriesRight}
          {sendEl}
        </div>
        {tray ? <div className="uic-composer-tray">{tray}</div> : null}
      </div>
    );
  }

  return (
    <div className={classNames.root ?? 'wbx-composer'}>
      {attachments}
      <textarea
        ref={taRef}
        className={classNames.input ?? 'wbx-composer-input'}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        rows={rows}
        autoFocus={autoFocus}
        aria-label={inputAriaLabel}
        onChange={(e) => onChange(e.target.value)}
        // Enter obeys sendDisabled, exactly as the send button does: two ways to trigger one
        // action must not disagree about whether it is available. (It still swallows the key —
        // a newline is not what Enter means in this box.) sendDisabled defaults to undefined,
        // so for a caller that never set it nothing changes.
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          e.preventDefault();
          if (!sendDisabled) onSend();
        }}
      />
      <div className={classNames.row ?? 'wbx-composer-row'}>
        {accessoriesLeft}
        <span style={{ flex: 1 }} />
        {accessoriesRight}
        {renderSend ? renderSend() : (
          <button type="button" className="uic-send" disabled={sendDisabled} onClick={() => onSend()} aria-label="Send message">
            <IcSend />
          </button>
        )}
      </div>
      {tray ? <div className="uic-composer-tray">{tray}</div> : null}
    </div>
  );
}
