// Realtime collaboration for a graph canvas: one Yjs doc per graph
// ("cg-schema:{kb}") on the platform collab sidecar, reached with a
// short-lived per-doc ticket the HOST fetches (the ContextualGraph app and
// the studio's Spaces authenticate differently, so the ticket fetch is
// injected, the way the sheet hook takes it). Built on the shared
// live-document core; a person's color is the shared palette's.
//
// The doc has two shared structures:
//   meta  (server-written) — schema: the full graph JSON pushed after every
//         mutation (copilot tools, inspector edits, saves), version, actor,
//         copilot {building, at}, explorer, connect. Clients render
//         meta.schema directly, so a copilot build animates on every open
//         canvas without polling.
//   draft (client-written) — the SHARED edit-mode draft. Keys mirror the
//         graph view's local draft shapes: "t:vertex:User" -> type draft,
//         "p:User" -> {x,y}. Values are plain JSON; per-key last-writer-wins,
//         so two editors converge (edits to different types always merge).
//
// Presence rides Yjs awareness: every client publishes
// {id, name, mode: viewing|editing, drag}; the copilot appears via meta.copilot.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveDoc } from '../collab/useLiveDoc.js';
import { peerColor } from '../collab/colors.js';

const T_PREFIX = 't:';
const P_PREFIX = 'p:';
const COPILOT_STALE_MS = 15 * 60 * 1000;   // ignore a building flag this old

function readDrafts(map) {
  const typeDrafts = {};
  const positionDrafts = {};
  map.forEach((v, k) => {
    if (k.startsWith(T_PREFIX)) typeDrafts[k.slice(T_PREFIX.length)] = v;
    else if (k.startsWith(P_PREFIX)) positionDrafts[k.slice(P_PREFIX.length)] = v;
  });
  return { typeDrafts, positionDrafts };
}

function readPeers(states, selfClientId) {
  const byId = new Map();
  for (const st of states || []) {
    const clientId = st.clientId;
    const u = st.user;
    if (!u || !u.id) continue;
    const cur = byId.get(u.id);
    // Prefer the editing entry when one person has several tabs open; a live
    // drag (u.drag = {label, x, y}) wins over everything (it implies action).
    if (!cur || (u.drag && !cur.drag) || (u.mode === 'editing' && cur.mode !== 'editing' && !cur.drag)) {
      byId.set(u.id, { id: u.id, name: u.name || 'User', mode: u.mode || 'viewing',
                       drag: u.drag || null, self: clientId === selfClientId });
    }
  }
  return [...byId.values()].sort((a, b) => (a.self === b.self ? a.name.localeCompare(b.name) : a.self ? -1 : 1));
}

/** Strictly-newer check for published schema stamps — (schema_version,
 *  capture ts) lexicographic; mirrors the sidecar's write guard so a late
 *  stale push can never revert a client's canvas. */
function newerStamp(last, sv, ts) {
  return sv > last.sv || (sv === last.sv && ts > last.ts);
}

/**
 * Live channel for one graph. Returns:
 *   ready          — connected to the doc (false = fall back to refresh-based UX)
 *   liveGraph      — the latest server-published schema JSON (null until one arrives)
 *   peers          — [{id, name, mode, self}] awareness roster
 *   copilotBuilding— the copilot is running a turn right now
 *   draftStore     — shared edit draft: {typeDrafts, positionDrafts, setTypeDrafts,
 *                    setPositionDrafts} (drop-in for the graph view's local state)
 *   setEditing     — publish viewing/editing presence mode
 */
export function useGraphCollab(graphId, user, { fetchTicket } = {}) {
  const live = useLiveDoc(graphId, { fetchTicket, field: 'user' });
  const ready = live.ready;
  const [liveGraph, setLiveGraph] = useState(null);
  const [copilotBuilding, setCopilotBuilding] = useState(false);
  const [explorer, setExplorer] = useState(null);   // {query, note, requested_by, version}
  const [connect, setConnect] = useState(null);     // latest published Connect tool registry
  const [drafts, setDrafts] = useState({ typeDrafts: {}, positionDrafts: {} });
  const providerRef = useRef(null);
  providerRef.current = live.provider;
  const draftsRef = useRef(drafts);
  const modeRef = useRef('viewing');
  const dragRef = useRef(null);
  const stampRef = useRef({ sv: -1, ts: -1 });   // last APPLIED schema stamp
  // Explorer channel stamp. null = unbaselined: the FIRST observed value (the
  // doc's history on connect) only sets the baseline — a query the copilot ran
  // before this window opened must not replay on load. Only strictly-newer
  // pushes that arrive while connected reach the consumer.
  const explorerStampRef = useRef(null);
  // Connect registry channel is STATE, not an event stream: the latest
  // observed value is simply the truth, so the doc's history on connect
  // applies too (the Connect pane reconciles it with its own REST fetch).
  // Dedup on serialized value to keep renders quiet across meta churn.
  const connectJsonRef = useRef('');
  const userRef = useRef(user);
  userRef.current = user;

  // What this canvas reads from the document, attached once the core has
  // synced it and detached when the graph changes.
  useEffect(() => {
    const ydoc = live.doc;
    if (!ydoc) {
      setLiveGraph(null); setCopilotBuilding(false); setExplorer(null); setConnect(null);
      stampRef.current = { sv: -1, ts: -1 };
      explorerStampRef.current = null;
      connectJsonRef.current = '';
      draftsRef.current = { typeDrafts: {}, positionDrafts: {} };
      setDrafts(draftsRef.current);
      return undefined;
    }
    let dead = false;
    const meta = ydoc.getMap('meta');
    const draft = ydoc.getMap('draft');
    const onMeta = () => {
      if (dead) return;
      const schema = meta.get('schema');
      if (schema) {
        // Apply only strictly-newer states (same discipline as the sidecar
        // write guard) — Yjs LWW plus racing publishers means an older
        // serialization CAN be observed after a newer one.
        const sv = Number(meta.get('schema_version') || 0);
        const ts = Number(meta.get('version') || 0);
        if (newerStamp(stampRef.current, sv, ts)) {
          stampRef.current = { sv, ts };
          setLiveGraph(schema);
        }
      }
      const cop = meta.get('copilot');
      setCopilotBuilding(!!(cop && cop.building && (!cop.at || Date.now() - cop.at < COPILOT_STALE_MS)));
      // Explorer channel: the copilot ran a query it wants shown. Strictly-
      // newer gating like the schema stamp; the first observation after
      // connect is the baseline only (never replayed).
      const ex = meta.get('explorer');
      const exVer = Number((ex && ex.version) || 0);
      if (explorerStampRef.current === null) {
        explorerStampRef.current = exVer;
      } else if (ex && ex.query && exVer > explorerStampRef.current) {
        explorerStampRef.current = exVer;
        setExplorer({ query: String(ex.query), note: String(ex.note || ''),
                      requested_by: String(ex.requested_by || ''), version: exVer });
      }
      // Connect tool registry: the server republishes the full registry
      // after every mutation (copilot meta-tools, REST saves) so open
      // Connect tabs converge without polling.
      const cn = meta.get('connect');
      if (cn) {
        let json = '';
        try { json = JSON.stringify(cn); } catch { /* unserializable — skip */ }
        if (json && json !== connectJsonRef.current) {
          connectJsonRef.current = json;
          setConnect(cn);
        }
      }
    };
    const onDraft = () => {
      if (dead) return;
      const next = readDrafts(draft);
      draftsRef.current = next;
      setDrafts(next);
    };
    meta.observe(onMeta);
    draft.observe(onDraft);
    onMeta();
    onDraft();
    return () => { dead = true; meta.unobserve(onMeta); draft.unobserve(onDraft); };
  }, [live.doc]);

  // Announce this person on join.
  useEffect(() => {
    const u = userRef.current || {};
    live.setAwareness({ id: u.id || 'me', name: u.name || 'User', mode: modeRef.current, drag: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId, live.setAwareness]);

  const peers = useMemo(() => readPeers(live.states, live.selfClientId), [live.states, live.selfClientId]);

  const pushAwareness = useCallback(() => {
    const u = userRef.current || {};
    live.setAwareness({ id: u.id || 'me', name: u.name || 'User', mode: modeRef.current, drag: dragRef.current });
  }, [live.setAwareness]);

  const setEditing = useCallback((editing) => {
    modeRef.current = editing ? 'editing' : 'viewing';
    pushAwareness();
  }, [pushAwareness]);

  // Live drag presence: while this user drags a node type, peers see
  // {label, x, y} on the awareness roster (coarse — callers throttle).
  // null clears it (mouse up).
  const setDrag = useCallback((label, pos) => {
    dragRef.current = label
      ? { label, x: Math.round((pos && pos.x) || 0), y: Math.round((pos && pos.y) || 0) }
      : null;
    pushAwareness();
  }, [pushAwareness]);

  // Shared draft setters — same call shapes as React state setters, mirrored
  // into the Y.Map so every editor sees the draft (and its live preview).
  const writeDrafts = useCallback((prefix, field, updater) => {
    const cur = draftsRef.current[field];
    const next = typeof updater === 'function' ? updater(cur) : updater;
    const p = providerRef.current;
    if (!p) {   // offline fallback: keep drafts local so edit mode still works
      draftsRef.current = { ...draftsRef.current, [field]: next };
      setDrafts(draftsRef.current);
      return;
    }
    const map = p.document.getMap('draft');
    p.document.transact(() => {
      for (const [k, v] of Object.entries(next || {})) {
        if (cur[k] !== v) map.set(prefix + k, v);
      }
      for (const k of Object.keys(cur || {})) {
        if (!(k in (next || {}))) map.delete(prefix + k);
      }
    });
  }, []);
  const setTypeDrafts = useCallback((u) => writeDrafts(T_PREFIX, 'typeDrafts', u), [writeDrafts]);
  const setPositionDrafts = useCallback((u) => writeDrafts(P_PREFIX, 'positionDrafts', u), [writeDrafts]);

  // Snapshot of the CURRENT shared draft (raw doc keys -> values). Taken right
  // before a save materializes, so the post-save cleanup can remove exactly
  // what the save consumed.
  const snapshotDraft = useCallback(() => {
    const { typeDrafts, positionDrafts } = draftsRef.current;
    const raw = {};
    for (const [k, v] of Object.entries(typeDrafts || {})) raw[T_PREFIX + k] = v;
    for (const [k, v] of Object.entries(positionDrafts || {})) raw[P_PREFIX + k] = v;
    return raw;
  }, []);

  // Conditional post-save cleanup: delete ONLY entries still equal to the
  // consumed snapshot. A key a peer (re)wrote while the save was in flight
  // compares unequal — or was never seen by this replica at all — and
  // SURVIVES as a pending draft instead of being wiped ("no operation lost").
  // This replaces the server's blanket draft clear, which nuked every entry
  // including ones written after the save's diff base was captured.
  const clearDraftEntries = useCallback((consumed) => {
    const entries = Object.entries(consumed || {});
    if (!entries.length) return;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const p = providerRef.current;
    if (!p) {   // offline fallback — drafts are local state
      const next = { typeDrafts: { ...draftsRef.current.typeDrafts },
                     positionDrafts: { ...draftsRef.current.positionDrafts } };
      for (const [k, v] of entries) {
        if (k.startsWith(T_PREFIX) && same(next.typeDrafts[k.slice(T_PREFIX.length)], v)) {
          delete next.typeDrafts[k.slice(T_PREFIX.length)];
        } else if (k.startsWith(P_PREFIX) && same(next.positionDrafts[k.slice(P_PREFIX.length)], v)) {
          delete next.positionDrafts[k.slice(P_PREFIX.length)];
        }
      }
      draftsRef.current = next;
      setDrafts(next);
      return;
    }
    const map = p.document.getMap('draft');
    p.document.transact(() => {
      for (const [k, v] of entries) {
        if (map.has(k) && same(map.get(k), v)) map.delete(k);
      }
    });
  }, []);

  return {
    ready,
    liveGraph,
    peers,
    copilotBuilding,
    // Latest copilot-shown query (show_query_results): {query, note,
    // requested_by, version}. Strictly-newer only; null until one arrives
    // while this window is connected.
    explorer,
    // Latest published Connect tool registry ({raw_enabled, tools}) — null
    // until the doc carries one; the Connect pane treats it as fresher truth
    // than its REST fetch.
    connect,
    setEditing,
    setDrag,
    snapshotDraft,
    clearDraftEntries,
    // Other people's in-flight node drags: [{id, name, color, label, x, y}] —
    // the canvas shows their indicator glued to the node they are moving,
    // in the same color as their presence avatar.
    dragPeers: peers.filter((p) => !p.self && p.drag)
      .map((p) => ({ id: p.id, name: p.name, color: peerColor(p.id),
                     label: p.drag.label, x: p.drag.x, y: p.drag.y })),
    draftStore: {
      typeDrafts: drafts.typeDrafts,
      positionDrafts: drafts.positionDrafts,
      setTypeDrafts,
      setPositionDrafts,
    },
  };
}

// ── draft materialization + save ─────────────────────────────────────────────
