// The sheet's live document, shared by every host that renders the grid (the
// Sheets app, the studio's Spaces page). The Yjs document IS the sheet while
// people edit it (sheetDoc.js holds the layout); this hook keeps a JSON
// snapshot of it for rendering and hands out the ops the grid edits with,
// each a Yjs transaction, so two people never clobber each other and every
// change reaches every viewer as it happens. The service writes the same
// document (copilot builds, batch runs) and keeps its own keys on `meta`
// (run, copilot). Presence rides awareness on the shared live-document core.
// Hosts differ in auth, so the ticket fetch and the current member are injected.
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as sheetDoc from './sheetDoc.js';
import { useLiveDoc } from '../collab/useLiveDoc.js';
import { peerColor } from '../collab/colors.js';

export { peerColor };

const COPILOT_STALE_MS = 15 * 60 * 1000;

/** The ops a host edits with, bound to one document. Each is one transaction. */
export function sheetOps(doc) {
  const one = (op) => sheetDoc.apply(doc, [op], 'local');
  return {
    setCell: (tab, key, cell) => one({ op: 'set_cell', tab, key, cell }),
    setCells: (tab, cells) => one({ op: 'set_cells', tab, cells }),
    setColumn: (tab, column, at) => one({ op: 'set_column', tab, column, ...(Number.isInteger(at) ? { at } : {}) }),
    deleteColumn: (tab, id) => one({ op: 'delete_column', tab, id }),
    moveColumn: (tab, id, at) => one({ op: 'move_column', tab, id, at }),
    setRow: (tab, row, at) => one({ op: 'set_row', tab, row, ...(Number.isInteger(at) ? { at } : {}) }),
    deleteRow: (tab, id) => one({ op: 'delete_row', tab, id }),
    moveRow: (tab, id, at) => one({ op: 'move_row', tab, id, at }),
    setTab: (tab, at) => one({ op: 'set_tab', tab, ...(Number.isInteger(at) ? { at } : {}) }),
    deleteTab: (id) => one({ op: 'delete_tab', id }),
    moveTab: (id, at) => one({ op: 'move_tab', id, at }),
    setTitle: (title) => one({ op: 'set_meta', key: 'title', value: title }),
  };
}

/** Returns { ready, sheet, ops, liveRun, copilotBuilding, peers, setPresence }.
 *  fetchTicket(resourceId) -> {url, doc, token} | null (host-authenticated).
 *  me -> {id, name, email} of the current member, for presence.
 *  Presence (awareness): {id, name, tab, sel: {a:[rowId,colId], f:[rowId,colId]}|null,
 *  typing: {key, text}|null, at}; peers come back with their palette color. */
export function useSheetCollab(resourceId, { fetchTicket, me } = {}) {
  const live = useLiveDoc(resourceId, { fetchTicket, field: 'presence' });
  const [sheet, setSheet] = useState(null);
  const [liveRun, setLiveRun] = useState(null);
  const [copilotBuilding, setCopilotBuilding] = useState(false);
  const who = me || {};

  // One snapshot per tick however many updates arrive: the grid renders JSON,
  // the document stays the truth. A timer, not an animation frame, so a tab
  // in the background keeps converging and is current the moment someone
  // returns to it.
  useEffect(() => {
    const ydoc = live.doc;
    if (!ydoc) { setSheet(null); setLiveRun(null); setCopilotBuilding(false); return undefined; }
    const meta = ydoc.getMap('meta');
    let timer = 0;
    let dead = false;
    const snapshot = () => {
      timer = 0;
      if (dead) return;
      setSheet(sheetDoc.toJSON(ydoc));
      setLiveRun(meta.get('run') || null);
      const cop = meta.get('copilot');
      setCopilotBuilding(!!(cop && cop.building && (!cop.at || Date.now() - cop.at < COPILOT_STALE_MS)));
    };
    const onUpdate = () => { if (!timer) timer = window.setTimeout(snapshot, 0); };
    ydoc.on('update', onUpdate);
    snapshot();
    return () => { dead = true; ydoc.off('update', onUpdate); window.clearTimeout(timer); };
  }, [live.doc]);

  // Announce this person on join (no selection yet).
  useEffect(() => {
    live.setAwareness({ id: who.id || '', name: who.name || who.email || 'Someone', tab: null, sel: null, typing: null, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, live.setAwareness]);

  // Everyone else in the document: every other client, including this same
  // person in another window (their selection there is worth seeing too).
  const peers = useMemo(() => {
    const out = [];
    for (const st of live.states) {
      const p = st.presence;
      if (!p || !p.id || st.clientId === live.selfClientId) continue;
      out.push({ ...p, clientId: st.clientId, color: peerColor(p.id) });
    }
    return out;
  }, [live.states, live.selfClientId]);

  const ops = useMemo(() => (live.doc ? sheetOps(live.doc) : null), [live.doc]);

  /** What this member is doing on a tab: their selection and, while they
   *  type in a cell, the text so far. */
  const setPresence = useCallback((tab, state) => {
    live.setAwareness({ id: who.id || '', name: who.name || who.email || 'Someone', tab: tab || null,
                        sel: (state && state.sel) || null, typing: (state && state.typing) || null, at: Date.now() });
  }, [live.setAwareness, who.id, who.name, who.email]);

  return { ready: live.ready, sheet, ops, liveRun, copilotBuilding, peers, setPresence };
}
