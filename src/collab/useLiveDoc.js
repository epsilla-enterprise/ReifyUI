// useLiveDoc — the one provider lifecycle for every live document on the
// platform's realtime sidecar: a sheet, a graph canvas, a doc. It takes a
// host-authenticated ticket ({url, doc, token}), connects, and asks the host
// for a fresh ticket on EVERY connect (the provider's token): the sidecar closes
// a connection when its ticket expires, so the person's access is checked again.
// fetchTicket returns a ticket, null (unreachable: retried quietly), or
// {refused: true} (the person's access was refused: `stopped`, no retry). It exposes
// the document once synced, the awareness states of everyone in it, and one
// field for what THIS person publishes (re-applied on every reconnect).
// Surfaces build their own shape on top: what to read from the document and
// what presence means for them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { keepPresenceAlive } from './keepAlive.js';

const REFUSED = 'refused';
const DISCONNECT_GRACE_MS = 2_000;   // a ticket's planned close re-syncs well inside this

export function useLiveDoc(resourceId, { fetchTicket, field = 'presence' } = {}) {
  const [doc, setDoc] = useState(null);           // the Y.Doc, once synced
  const [provider, setProvider] = useState(null);
  const [ready, setReady] = useState(false);
  const [states, setStates] = useState([]);       // [{clientId, ...awareness}]
  const [selfClientId, setSelfClientId] = useState(null);
  const [stopped, setStopped] = useState(false);  // live access refused (removed, signed out): reload
  const providerRef = useRef(null);
  const lastRef = useRef(null);                   // this person's last published value

  useEffect(() => {
    if (!resourceId || typeof fetchTicket !== 'function') return undefined;
    let dead = false;
    let current = null;
    let retry = null;
    let grace = null;
    let stopKeepAlive = () => {};

    async function connect() {
      let ticket = null;
      try { ticket = await fetchTicket(resourceId); } catch { ticket = null; }
      if (dead) return;
      if (ticket && ticket.refused) { setStopped(true); return; }
      if (!ticket) { retry = window.setTimeout(connect, 60_000); return; }   // realtime unreachable: try later
      let first = ticket.token;
      current = new HocuspocusProvider({
        url: ticket.url, name: ticket.doc,
        token: async () => {
          if (first) { const t = first; first = null; return t; }
          let next = null;
          try { next = await fetchTicket(resourceId); } catch { next = null; }
          if (next && next.refused) throw new Error(REFUSED);
          if (!next || !next.token) throw new Error('unavailable');
          return next.token;
        },
        onAuthenticationFailed: ({ reason } = {}) => {
          stopKeepAlive();
          try { current.destroy(); } catch { /* down */ }
          if (dead) return;
          window.clearTimeout(grace);
          setReady(false);
          if (String(reason || '').includes(REFUSED)) { setStopped(true); return; }
          retry = window.setTimeout(connect, 5_000);   // unavailable for now: a fresh ticket shortly
        },
      });
      stopKeepAlive = keepPresenceAlive(current.awareness);
      providerRef.current = current;
      setProvider(current);
      if (lastRef.current) { try { current.setAwarenessField(field, lastRef.current); } catch { /* not yet */ } }
      current.on('awarenessUpdate', ({ states: next }) => { if (!dead) setStates(next || []); });
      current.on('synced', () => {
        if (dead) return;
        window.clearTimeout(grace);
        setSelfClientId(current.awareness ? current.awareness.clientID : null);
        setDoc(current.document);
        setReady(true);
      });
      current.on('status', ({ status }) => {
        if (dead) return;
        if (status === 'connected') window.clearTimeout(grace);
        // a planned close at ticket expiry reconnects at once; only a real outage reads as offline
        if (status === 'disconnected') {
          window.clearTimeout(grace);
          grace = window.setTimeout(() => { if (!dead) setReady(false); }, DISCONNECT_GRACE_MS);
        }
      });
    }
    setStopped(false);
    connect();
    return () => {
      dead = true; window.clearTimeout(retry); window.clearTimeout(grace);
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

  return { doc, provider, ready, stopped, states, selfClientId, setAwareness };
}
