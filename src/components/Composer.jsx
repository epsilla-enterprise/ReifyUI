// Composer — extracted from HarnessRouter's workbench composer (textarea + bottom action row).
// Enter sends (Shift+Enter for a newline). Auto-grows to fit content, capped at maxRows, then
// scrolls (HR behavior; pass autoGrow={false} for a fixed-height textarea).
//
// Slots:
//   attachments        node rendered ABOVE the textarea (attachment card row)
//   accessoriesLeft    nodes before the flexible spacer (attach button, model select, mic, …)
//   accessoriesRight   nodes after the spacer, before the send button
//   renderSend()       replaces the default send button entirely
//   classNames         { root, input, row } — each REPLACES the default class when provided,
//                      so a product can restyle wholesale without fighting the package CSS
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
    maxRows = 15,
    attachments,
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
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
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
    </div>
  );
}
