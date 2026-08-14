// One Escape key, one stack.
//
// The package now has three things that float above the page — the dialog host, Modal and
// Popover — and each of them wanting its own document keydown listener is how Escape ends up
// closing two of them at once. They register here instead: the LAST one opened owns Escape, and
// nothing below it hears the key.
//
// Deliberately not a React context: a Popover inside a Modal inside a dialog is a legitimate
// arrangement, and the ordering that matters is the order they OPENED in, which is exactly what
// an array push/splice records. A context would order them by tree position instead.
//
// Internal to the package (not exported from the root): a consumer that wants this behaviour
// gets it by using the overlay components, not by wiring the stack itself.
import { useEffect } from 'react';

const stack = [];
let listening = false;

function onKey(e) {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.onEscape?.();
}

function listen() {
  if (listening || typeof document === 'undefined') return;
  document.addEventListener('keydown', onKey);
  listening = true;
}

function unlisten() {
  if (!listening || stack.length) return;
  document.removeEventListener('keydown', onKey);
  listening = false;
}

/** Push while mounted-and-open. Returns the dispose. `onEscape` is read live, so a handler that
 *  closes over changing state does not have to re-register. */
export function pushOverlay(entry) {
  stack.push(entry);
  listen();
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    unlisten();
  };
}

/**
 * Escape closes THIS overlay only while it is the top-most one.
 * `active` is false for an overlay that is closed, or that is not the top of its own local stack
 * (the dialog host layers several at once and only the last should answer).
 */
export function useOverlayEscape(active, onEscape) {
  useEffect(() => {
    if (!active) return undefined;
    // The entry object is stable for the life of this registration; onEscape is captured with it,
    // and the effect re-runs whenever the caller's handler identity changes.
    return pushOverlay({ onEscape });
  }, [active, onEscape]);
}
