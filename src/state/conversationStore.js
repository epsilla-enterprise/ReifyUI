// Session-continuation store — extracted from HarnessRouter's workbench conv store.
// A module-level (per createConversationStore() instance) map of conversation state keyed by
// session id (or any stable key for a not-yet-allocated conversation), so:
//   - switching conversations never destroys an optimistic user message or an in-flight stream
//   - N concurrent turns all keep streaming into their own entries in the background
//   - a broadcast/bus event source can write to the same entry the POST stream writes to
//
// State shape (extend via patches — unknown keys pass through):
//   { msgs, busy, prevId, firstTurn, loaded }
// prevId is the last response id (previous_response_id chaining = session continuation).
import { useSyncExternalStore } from 'react';

export function createConversationStore(makeInitial) {
  const initial = makeInitial || (() => ({ msgs: [], busy: false, prevId: null, firstTurn: true, loaded: false }));
  const store = new Map();
  const subs = new Map();

  function get(key) {
    let s = store.get(key);
    if (!s) { s = initial(); store.set(key, s); }
    return s;
  }
  function set(key, patch) {
    const cur = get(key);
    const p = typeof patch === 'function' ? patch(cur) : patch;
    store.set(key, { ...cur, ...p });
    subs.get(key)?.forEach((f) => f());
  }
  /** Rebind/seed a key directly (e.g. copy a new-conversation entry onto its real session id). */
  function seed(key, state) { store.set(key, state); subs.get(key)?.forEach((f) => f()); }
  /** Mutate the LAST assistant message of a conversation (streaming writes). */
  function updateLastAssistant(key, fn) {
    set(key, (s) => {
      const out = s.msgs.slice();
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].role === 'assistant') { const a = { ...out[i] }; fn(a); out[i] = a; break; }
      }
      return { msgs: out };
    });
  }
  /** React hook: subscribe a component to one conversation's state. */
  function use(key) {
    return useSyncExternalStore(
      (cb) => {
        let set_ = subs.get(key);
        if (!set_) { set_ = new Set(); subs.set(key, set_); }
        set_.add(cb);
        return () => { set_.delete(cb); };
      },
      () => get(key),
      () => get(key),
    );
  }
  return { get, set, seed, updateLastAssistant, use };
}
