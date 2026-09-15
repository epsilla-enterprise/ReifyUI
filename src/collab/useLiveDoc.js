// useLiveDoc — the one provider lifecycle for every live document on the
// platform's realtime sidecar: a sheet, a graph canvas, a doc. It takes a
// host-authenticated ticket ({url, doc, token}), connects, re-tickets when the
// token ages out, retries quietly when realtime is unreachable, and exposes
// the document once synced, the awareness states of everyone in it, and one
// field for what THIS person publishes (re-applied on every reconnect).
// Surfaces build their own shape on top: what to read from the document and
// what presence means for them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { keepPresenceAlive } from './keepAlive.js';

export function useLiveDoc(resourceId, { fetchTicket, field = 'presence' } = {}) {
  const [doc, setDoc] = useState(null);           // the Y.Doc, once synced
  const [provider, setProvider] = useState(null);
  const [ready, setReady] = useState(false);
  const [states, setStates] = useState([]);       // [{clientId, ...awareness}]
  const [selfClientId, setSelfClientId] = useState(null);
  const providerRef = useRef(null);
  const lastRef = useRef(null);                   // this person's last published value

  useEffect(() => {
    if (!resourceId || typeof fetchTicket !== 'function') return undefined;
    let dead = false;
    let current = null;
    let retry = null;
    let stopKeepAlive = () => {};

    async function connect() {
      let ticket = null;
      try { ticket = await fetchTicket(resourceId); } catch { ticket = null; }
      if (dead) return;
      if (!ticket) { retry = window.setTimeout(connect, 60_000); return; }   // realtime unreachable: try later
      current = new HocuspocusProvider({
        url: ticket.url, name: ticket.doc, parameters: { cg_token: ticket.token },
        onAuthenticationFailed: () => {
          // The token aged out (or access was revoked): tear down and re-ticket.
          stopKeepAlive();
          try { current.destroy(); } catch { /* down */ }
          if (!dead) retry = window.setTimeout(connect, 5_000);
        },
      });
      stopKeepAlive = keepPresenceAlive(current.awareness);
      providerRef.current = current;
      setProvider(current);
      if (lastRef.current) { try { current.setAwarenessField(field, lastRef.current); } catch { /* not yet */ } }
      current.on('awarenessUpdate', ({ states: next }) => { if (!dead) setStates(next || []); });
      current.on('synced', () => {
        if (dead) return;
        setSelfClientId(current.awareness ? current.awareness.clientID : null);
        setDoc(current.document);
        setReady(true);
      });
      current.on('status', ({ status }) => { if (!dead && status === 'disconnected') setReady(false); });
    }
    connect();
    return () => {
      dead = true; window.clearTimeout(retry);
      stopKeepAlive();
      if (current) { try { current.destroy(); } catch { /* closing */ } }
      providerRef.current = null;
      setProvider(null); setDoc(null); setReady(false); setStates([]); setSelfClientId(null);
    };
    // fetchTicket is a host constant; re-subscribing on its identity would reconnect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  /** Publish what this person is doing; kept and re-applied across reconnects. */
  const setAwareness = useCallback((value) => {
    lastRef.current = value;
    const p = providerRef.current;
    if (p) { try { p.setAwarenessField(field, value); } catch { /* closing */ } }
  }, [field]);

  return { doc, provider, ready, states, selfClientId, setAwareness };
}
