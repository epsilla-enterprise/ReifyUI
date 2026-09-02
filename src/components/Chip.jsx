// Chip — a small labelled token: a staged file, a chosen template, a filter that is set.
//
// Three spellings of this existed across four apps, and the interactive ones were built as
// <span role="button" tabIndex={0}> with a keydown handler that only answered Enter (never
// Space), inside another button. Here the pressable parts are real <button>s, so the keyboard,
// the accessibility tree and the browser's own focus ring all work without being re-implemented.
//
// Width is CSS, not a prop: two of the copies set maxWidth 180 and 220 inline on the same
// component in the same app. The label ellipsizes against the row it is in.
import React, { forwardRef } from 'react';
import { IcX } from './icons.jsx';

/**
 * label      the text (a node — e.g. name + a size span)
 * icon       leading glyph
 * title      native tooltip, usually the untruncated label
 * selected   this chip stands for something chosen (brand fill)
 * onClick    makes the chip itself a button
 * slot       the dashed "open slot" look for a chip that stands for a choice not yet made
 *            (+ add a file). Defaults to clickable-and-unselected, which is how every earlier
 *            caller got it; pass slot={false} for a chip that is clickable AND already set,
 *            e.g. a chosen route that opens its own editor.
 * onRemove   adds a trailing ✕ button; removeLabel is REQUIRED with it, because "✕" alone tells
 *            a screen reader nothing about which of five chips it removes
 * trailing   a node rendered between the label and the ✕ — a compact control the chip carries,
 *            e.g. a per-route model <select> in a comparison bar. It is the CALLER's control:
 *            the chip never wraps it in its own press target, so a select inside a clickable
 *            chip still opens instead of triggering the chip.
 * ref        lands on the OUTERMOST element, the box a Popover or CascadeMenu anchors against.
 * ...rest    goes onto the press target (aria-expanded, aria-haspopup, data-*), so a chip that
 *            opens a menu can say so to assistive tech without the library naming every attribute.
 */
export const Chip = forwardRef(function Chip(props, ref) {
  const { label, icon, title, selected = false, onClick, onRemove, removeLabel, trailing, className,
          slot, ...rest } = props;
  const isSlot = slot ?? (Boolean(onClick) && !selected);
  const cls = ['uic-chip',
    selected ? 'is-selected' : '',
    isSlot ? 'is-open' : '',
    className || ''].filter(Boolean).join(' ');

  const body = (
    <>
      {icon ? <span className="uic-chip-ic" aria-hidden="true">{icon}</span> : null}
      <span className="uic-chip-l">{label}</span>
    </>
  );

  // A chip that is both pressable and removable is two controls, so the outer element stays a
  // plain span and the press target becomes its own button — never a button inside a button.
  const trail = trailing ? <span className="uic-chip-tr">{trailing}</span> : null;

  if (onClick && onRemove) {
    return (
      <span ref={ref} className={cls} title={title}>
        <button type="button" className="uic-chip-press" onClick={onClick} {...rest}>{body}</button>
        {trail}
        <button type="button" className="uic-chip-x" aria-label={removeLabel} onClick={onRemove}>
          <IcX size={12} />
        </button>
      </span>
    );
  }
  if (onClick) {
    // trailing needs its own interactivity, and a control inside a <button> is invalid HTML the
    // browser un-nests unpredictably — so a clickable chip that carries one keeps the split form.
    if (trailing) {
      return (
        <span ref={ref} className={cls} title={title}>
          <button type="button" className="uic-chip-press" onClick={onClick} {...rest}>{body}</button>
          {trail}
        </span>
      );
    }
    return <button ref={ref} type="button" className={cls} title={title} onClick={onClick} {...rest}>{body}</button>;
  }
  return (
    <span ref={ref} className={cls} title={title} {...rest}>
      {body}
      {trail}
      {onRemove ? (
        <button type="button" className="uic-chip-x" aria-label={removeLabel} onClick={onRemove}>
          <IcX size={12} />
        </button>
      ) : null}
    </span>
  );
});
