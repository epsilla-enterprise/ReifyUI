// One agent turn as data, built from the events that really happened.
//
// A Turn is what the agent-chat components render:
//
//   { id, sessionId, status: 'running'|'done'|'failed'|'cancelled'|'incomplete',
//     user: { text, files: [{name}] } | null,
//     items: Item[],                       // in the order they happened
//     files: [{container_id, file_id, filename, download_url?}],
//     startedAt, endedAt,                  // epoch ms, or null when nobody observed them
//     lastEventAt,                         // epoch ms of the last live event, or null
//     usage, error, incomplete: {reason, detail} | null, model }
//
//   Item = { kind: 'text', id, text }
//        | { kind: 'thinking', id, text, startedAt, endedAt }
//        | { kind: 'tool', id, name, args, output, status: 'running'|'done'|'failed'|'stopped',
//            startedAt, endedAt }
//
// THE CLOCK RULE. Every time on a Turn is a moment someone observed. reduceTurn(turn, ev, at) takes
// `at` from the caller: the receive time for a live event, and null for a replayed one (a catch-up
// frame, a history read). A null never becomes a time, so a replay cannot invent a duration, and a
// view shows a duration only when both of its ends are real.
//
// Pure functions. No React, no fetch. The reducer never mutates its input.

import { toolKind } from './tools.js';

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'incomplete']);

/** A turn that has been sent and not yet answered. */
export function newTurn(opts = {}) {
  return {
    id: opts.id || null,
    sessionId: opts.sessionId || null,
    status: opts.status || 'running',
    user: opts.user ? { text: String(opts.user.text || ''), files: (opts.user.files || []).map((f) => ({ name: f.name, size: f.size, src: f.src })) } : null,
    items: [],
    files: [],
    startedAt: opts.startedAt ?? null,
    endedAt: null,
    elapsedMs: null,
    lastEventAt: null,
    usage: null,
    error: null,
    incomplete: null,
    model: opts.model || null,
    _oi: {},       // output_index -> item id, to route deltas that name only their index
  };
}

export function isTerminal(status) { return TERMINAL.has(status); }

function mapStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'completed' || v === 'done' || v === 'succeeded') return 'done';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  if (v === 'incomplete' || v === 'max_turns' || v === 'timeout' || v === 'max_steps') return 'incomplete';
  if (v === 'failed' || v === 'error') return 'failed';
  if (v === 'running' || v === 'in_progress' || v === 'queued' || v === 'starting') return 'running';
  return 'done';
}

function findIdx(items, pred) {
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) return i;
  return -1;
}

function patchItem(turn, i, patch) {
  const items = turn.items.slice();
  items[i] = { ...items[i], ...patch };
  return { ...turn, items };
}

function pushItem(turn, item, oi) {
  const t = { ...turn, items: [...turn.items, item] };
  if (oi !== undefined && oi !== null) t._oi = { ...turn._oi, [oi]: item.id };
  return t;
}

function isAgentTool(name) { return toolKind(name) === 'agent'; }

/** The model only speaks again once the calls it made have answered. A call still open when it
 *  does was answered off the record (Codex reports some calls with no result at all), so it is
 *  closed: done, with no output and no end time, which is what is actually known. A sub-agent's
 *  call is the exception, since its own messages stream while it is still working. */
function settleOpenCalls(turn) {
  let changed = false;
  const items = turn.items.map((it) => {
    if (it.kind === 'tool' && it.status === 'running' && !isAgentTool(it.name)) { changed = true; return { ...it, status: 'done' }; }
    return it;
  });
  return changed ? { ...turn, items } : turn;
}

function closeThinking(turn, at) {
  const i = findIdx(turn.items, (x) => x.kind === 'thinking' && x.endedAt == null && x.open);
  if (i < 0) return turn;
  return patchItem(turn, i, { open: false, endedAt: at ?? null });
}

function outputFailed(item) {
  if (!item) return false;
  if (item.is_error === true || item.isError === true) return true;
  const s = String(item.status || '').toLowerCase();
  return s === 'failed' || s === 'error' || s === 'incomplete';
}

function textOf(v) { return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v); }

function idOf(prefix, turn) { return `${prefix}_${turn.items.length}`; }

/**
 * Fold one event into a turn. `ev` is a Responses stream event (`response.output_text.delta`, …),
 * an `error` event, or the broadcast feed's `harness.turn.started`. `at` is the receive time in
 * epoch ms for a live event, null for a replayed one. Unknown events return the turn unchanged.
 */
export function reduceTurn(turn, ev, at = null) {
  if (!ev || typeof ev !== 'object') return turn;
  let t = turn || newTurn();
  const type = String(ev.type || '');
  if (at != null) t = { ...t, lastEventAt: at };
  switch (type) {
    case 'harness.turn.started': {
      if (!t.user && ev.user_text) t = { ...t, user: { text: String(ev.user_text), files: [] } };
      return t;
    }
    case 'response.created':
    case 'response.in_progress':
    case 'response.queued': {
      const r = ev.response || {};
      return {
        ...t,
        id: r.id || t.id,
        sessionId: (r.metadata && r.metadata.session_id) || t.sessionId,
        model: r.model || t.model,
        startedAt: t.startedAt ?? (at ?? (r.created_at ? r.created_at * 1000 : null)),
      };
    }
    case 'response.output_item.added':
    case 'response.output_item.done': {
      const item = ev.item || {};
      const added = type.endsWith('.added');
      const oi = ev.output_index;
      if (item.type === 'reasoning') {
        const i = findIdx(t.items, (x) => x.id === item.id);
        const summary = Array.isArray(item.summary) ? item.summary.map((p) => p && p.text).filter(Boolean).join('\n\n') : '';
        if (i < 0) {
          t = settleOpenCalls(t);
          t = pushItem(t, { kind: 'thinking', id: item.id || idOf('rs', t), text: summary, startedAt: at, endedAt: added ? null : at, open: added }, oi);
          return t;
        }
        if (!added) {
          const cur = t.items[i];
          return patchItem(t, i, { open: false, endedAt: cur.endedAt ?? at, text: cur.text || summary });
        }
        return t;
      }
      if (item.type === 'message') {
        const i = findIdx(t.items, (x) => x.id === item.id);
        const full = Array.isArray(item.content) ? item.content.map((p) => (p && (p.text || p.refusal)) || '').join('') : '';
        if (i < 0) {
          t = closeThinking(settleOpenCalls(t), at);
          const last = t.items[t.items.length - 1];
          // a message that continues the prose already on screen extends it (one paragraph flow)
          if (last && last.kind === 'text' && !last.closed) {
            t = { ...t, _oi: oi != null ? { ...t._oi, [oi]: last.id } : t._oi };
            if (!added && full && !last.text) t = patchItem(t, t.items.length - 1, { text: full });
            return t;
          }
          return pushItem(t, { kind: 'text', id: item.id || idOf('msg', t), text: added ? '' : full }, oi);
        }
        if (!added && full && !t.items[i].text) return patchItem(t, i, { text: full });
        return t;
      }
      if (item.type === 'function_call' || item.type === 'custom_tool_call' || item.type === 'mcp_call') {
        const callId = item.call_id || item.id || idOf('call', t);
        const args = textOf(item.arguments ?? item.input ?? '');
        const i = findIdx(t.items, (x) => x.kind === 'tool' && (x.id === callId || x.itemId === item.id));
        if (i >= 0) {
          const cur = t.items[i];
          const patch = {};
          if (args && (!cur.args || cur.args === '{}')) patch.args = args;
          if (item.name && (!cur.name || cur.name === 'tool')) patch.name = item.name;
          return Object.keys(patch).length ? patchItem(t, i, patch) : t;
        }
        t = closeThinking(t, at);
        const lastText = findIdx(t.items, (x) => x.kind === 'text');
        if (lastText >= 0) t = patchItem(t, lastText, { closed: true });
        return pushItem(t, { kind: 'tool', id: callId, itemId: item.id || null, name: item.name || 'tool', args,
          output: undefined, status: 'running', startedAt: at, endedAt: null }, oi);
      }
      if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
        const callId = item.call_id || '';
        const i = findIdx(t.items, (x) => x.kind === 'tool' && x.id === callId);
        const failed = outputFailed(item);
        const output = textOf(item.output);
        if (i < 0) {
          // a result whose call never reached this view (joined mid-turn): keep it, unnamed
          return pushItem(t, { kind: 'tool', id: callId || idOf('out', t), itemId: null, name: 'tool', args: '',
            output, status: failed ? 'failed' : 'done', startedAt: null, endedAt: at });
        }
        const cur = t.items[i];
        if (cur.output !== undefined && cur.status !== 'running') return t;     // the same result, twice
        return patchItem(t, i, { output, status: failed ? 'failed' : 'done', endedAt: at });
      }
      return t;
    }
    case 'response.reasoning_summary_part.added':
      return t;
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const d = String(ev.delta || '');
      let i = findIdx(t.items, (x) => x.kind === 'thinking' && (x.id === ev.item_id || (ev.output_index != null && t._oi[ev.output_index] === x.id)));
      if (i < 0) i = (t.items.length && t.items[t.items.length - 1].kind === 'thinking') ? t.items.length - 1 : -1;
      if (i < 0) {
        t = settleOpenCalls(t);
        return pushItem(t, { kind: 'thinking', id: ev.item_id || idOf('rs', t), text: d, startedAt: at, endedAt: null, open: true }, ev.output_index);
      }
      const cur = t.items[i];
      // a new summary part of the same reasoning reads as a new paragraph
      return patchItem(t, i, { text: cur.text + d });
    }
    case 'response.reasoning_summary_part.done':
      return t;
    case 'response.output_text.delta': {
      const d = String(ev.delta || '');
      if (!d) return t;
      let i = findIdx(t.items, (x) => x.kind === 'text' && (x.id === ev.item_id || (ev.output_index != null && t._oi[ev.output_index] === x.id)));
      if (i < 0 && t.items.length && t.items[t.items.length - 1].kind === 'text' && !t.items[t.items.length - 1].closed) i = t.items.length - 1;
      if (i < 0) {
        t = closeThinking(settleOpenCalls(t), at);
        return pushItem(t, { kind: 'text', id: ev.item_id || idOf('msg', t), text: d }, ev.output_index);
      }
      if (i !== t.items.length - 1) {
        // text for a message that is no longer last: the model is speaking again, after its calls
        t = closeThinking(settleOpenCalls(t), at);
      }
      return patchItem(t, i, { text: t.items[i].text + d });
    }
    case 'response.output_text.done': {
      const i = findIdx(t.items, (x) => x.kind === 'text' && x.id === ev.item_id);
      if (i >= 0 && !t.items[i].text && ev.text) return patchItem(t, i, { text: String(ev.text) });
      return t;
    }
    case 'response.function_call_arguments.delta': {
      const i = findIdx(t.items, (x) => x.kind === 'tool' && (x.itemId === ev.item_id || (ev.output_index != null && t._oi[ev.output_index] === x.id)));
      if (i < 0) return t;
      return patchItem(t, i, { args: (t.items[i].args || '') + String(ev.delta || '') });
    }
    case 'response.function_call_arguments.done': {
      const i = findIdx(t.items, (x) => x.kind === 'tool' && (x.itemId === ev.item_id || (ev.output_index != null && t._oi[ev.output_index] === x.id)));
      if (i < 0) return t;
      return patchItem(t, i, { args: String(ev.arguments ?? t.items[i].args ?? '') });
    }
    case 'response.output_text.annotation.added': {
      const a = ev.annotation || {};
      if (a.type !== 'container_file_citation') return t;
      const same = (f) => (a.file_id ? f.file_id === a.file_id && f.container_id === a.container_id : f.filename === a.filename);
      if (t.files.some(same)) return t;
      return { ...t, files: [...t.files, { container_id: a.container_id, file_id: a.file_id, filename: a.filename,
        ...(a.download_url ? { download_url: a.download_url } : {}) }] };
    }
    case 'response.completed':
    case 'response.incomplete':
    case 'response.failed':
    case 'response.cancelled': {
      const r = ev.response || {};
      let status = type === 'response.completed' ? 'done' : type === 'response.incomplete' ? 'incomplete'
        : type === 'response.cancelled' ? 'cancelled' : mapStatus(r.status || 'failed');
      if (type === 'response.failed' && (ev.reason === 'cancelled' || r.status === 'cancelled')) status = 'cancelled';
      if (type === 'response.failed' && status === 'done') status = 'failed';
      return finish(t, status, at, r);
    }
    case 'error': {
      const msg = String(ev.message || (ev.error && ev.error.message) || '').trim();
      return msg ? { ...t, error: msg } : t;
    }
    default:
      return t;
  }
}

/** Settle a turn: its status, its end, what it used, and every call still open. */
export function finish(turn, status, at = null, response = null) {
  const r = response || {};
  const st = isTerminal(status) ? status : mapStatus(status);
  const items = turn.items.map((it) => {
    if (it.kind === 'tool' && it.status === 'running') return { ...it, status: st === 'done' ? 'done' : 'stopped' };
    if (it.kind === 'thinking' && it.open) return { ...it, open: false, endedAt: it.endedAt ?? at };
    return it;
  });
  const inc = r.incomplete_details;
  const err = r.error && (r.error.message || r.error.code);
  return {
    ...turn,
    items,
    status: st,
    endedAt: turn.endedAt ?? at,
    id: r.id || turn.id,
    usage: r.usage || turn.usage,
    model: r.served_model || r.model || turn.model,
    error: turn.error || (st === 'failed' && err ? String(err) : turn.error),
    incomplete: st === 'incomplete' && inc ? { reason: inc.reason || '', detail: inc.detail || '' } : turn.incomplete,
  };
}

/** Fold a list of events (a replay) into one turn. Pass `at` only for events observed live. */
export function turnFromEvents(events, opts = {}) {
  let t = newTurn(opts);
  for (const ev of events || []) t = reduceTurn(t, ev, opts.at ?? null);
  return t;
}

/** A stored Responses object (GET /v1/responses/{id}) as a turn: its output in order. */
export function turnFromResponse(resp, opts = {}) {
  const r = resp || {};
  let t = newTurn({ ...opts, id: r.id, model: r.model });
  const events = [];
  (r.output || []).forEach((item, i) => events.push({ type: 'response.output_item.done', output_index: i, item }));
  for (const ev of events) t = reduceTurn(t, ev, null);
  const st = mapStatus(r.status);
  if (st === 'running') return { ...t, status: 'running' };
  const created = r.created_at ? r.created_at * 1000 : null;
  t = finish(t, st, null, r);
  return { ...t, startedAt: opts.startedAt ?? created, endedAt: opts.endedAt ?? null };
}

/**
 * One turn of a session's history (the gateway's /v1/sessions/{sid}/turns entry) as a turn.
 * That record keeps the calls and the answer but not their interleaving, so its calls come first
 * and its answer after; `elapsed` (seconds) is kept as the turn's measured length.
 */
export function turnFromHistory(h) {
  const x = h || {};
  let t = newTurn({ id: x.id, user: (x.user || (x.user_files || []).length) ? { text: x.user || '', files: x.user_files || [] } : null });
  const items = [];
  (x.tools || []).forEach((c, i) => {
    const out = c.output ?? c.result;
    items.push({ kind: 'tool', id: c.call_id || `call_${i}`, itemId: null, name: c.name || 'tool', args: textOf(c.arguments ?? ''),
      output: out == null ? undefined : String(out), status: c.is_error ? 'failed' : 'done', startedAt: null, endedAt: null,
      truncated: c.output_truncated || null });
  });
  if (x.assistant) items.push({ kind: 'text', id: `msg_${items.length}`, text: String(x.assistant) });
  const status = mapStatus(x.status);
  t = { ...t, items, files: (x.files || []).slice(), status, model: x.served_model || x._model || null,
    elapsedMs: typeof x.elapsed === 'number' ? Math.round(x.elapsed * 1000) : null,
    error: x.error || null,
    incomplete: status === 'incomplete' && (x.incomplete_reason || x.incomplete_detail)
      ? { reason: x.incomplete_reason || '', detail: x.incomplete_detail || '' } : null };
  if (status === 'running') {
    // the calls still without a result are the ones running
    t.items = t.items.map((it) => (it.kind === 'tool' && it.output === undefined ? { ...it, status: 'running' } : it));
  }
  return t;
}

/**
 * A message in the ChatMessages/blocks model ({role:'assistant', blocks, status, files, elapsed})
 * as a turn. Content comes from the blocks; times come from `clock`, a turn the host folded from
 * the same live events with reduceTurn, matched call by call. Without a clock nothing is timed.
 */
export function turnFromMessage(msg, clock = null, user = null) {
  const m = msg || {};
  const status = m.status ? mapStatus(m.status) : 'done';
  const byCall = {};
  const thinkingClocks = [];
  if (clock) {
    for (const it of clock.items) {
      if (it.kind === 'tool') byCall[it.id] = it;
      else if (it.kind === 'thinking') thinkingClocks.push(it);
    }
  }
  const items = [];
  let errText = '';
  let thinkN = 0;
  (m.blocks || []).forEach((b, bi) => {
    if (b.kind === 'text') {
      if (b.error) { errText = String(b.text || '').replace(/^\s*Error:\s*/, '').trim(); return; }
      if (b.text) items.push({ kind: 'text', id: `msg_${bi}`, text: b.text });
      return;
    }
    if (b.kind === 'tools') {
      if (b.reasoning) {
        const c = thinkingClocks[thinkN++];
        items.push({ kind: 'thinking', id: `rs_${bi}`, text: b.reasoning, startedAt: c ? c.startedAt : null,
          endedAt: c ? c.endedAt : null, open: c ? !!c.open : false });
      }
      (b.steps || []).forEach((s, si) => {
        const c = s.callId ? byCall[s.callId] : null;
        const answered = s.result !== undefined;
        let st = c ? c.status : (answered ? 'done' : (status === 'running' ? 'running' : (status === 'done' ? 'done' : 'stopped')));
        if (s.isError || s.is_error) st = 'failed';
        if (answered && st === 'running') st = (s.isError || s.is_error) ? 'failed' : 'done';
        // a clock that missed the end (its stream dropped) must not keep a finished turn's call running
        if (st === 'running' && status !== 'running') st = status === 'done' ? 'done' : 'stopped';
        items.push({ kind: 'tool', id: s.callId || `call_${bi}_${si}`, itemId: null, name: s.name || 'tool', args: textOf(s.args ?? ''),
          output: answered ? String(s.result) : (c ? c.output : undefined), status: st,
          startedAt: c ? c.startedAt : null, endedAt: c ? c.endedAt : null });
      });
    }
  });
  let t = {
    ...newTurn({ user: user || null }),
    id: (clock && clock.id) || m.id || null,
    status,
    items,
    files: (m.files || []).slice(),
    startedAt: clock ? clock.startedAt : null,
    endedAt: clock ? clock.endedAt : null,
    lastEventAt: clock ? clock.lastEventAt : null,
    usage: clock ? clock.usage : null,
    model: (clock && clock.model) || null,
    error: errText || (clock && clock.error) || null,
    elapsedMs: typeof m.elapsed === 'number' ? Math.round(m.elapsed * 1000) : null,
    incomplete: status === 'incomplete' && (m.incompleteReason || m.incompleteDetail)
      ? { reason: m.incompleteReason || '', detail: m.incompleteDetail || '' } : null,
  };
  if (status === 'running') {
    // the model speaking after a call closes it (see settleOpenCalls); applied to blocks the same way
    let lastSpeech = -1;
    t.items.forEach((it, i) => { if (it.kind === 'text' || it.kind === 'thinking') lastSpeech = i; });
    t.items = t.items.map((it, i) => (it.kind === 'tool' && it.status === 'running' && i < lastSpeech && !isAgentTool(it.name)
      ? { ...it, status: 'done' } : it));
  }
  return t;
}

/**
 * What the turn is doing right now, for the live line:
 *   { phase: 'starting'|'thinking'|'tool'|'writing', tool: Item|null }
 * or null when the turn is not running. Derived from the items alone, never from a timer.
 */
export function liveState(turn) {
  if (!turn || turn.status !== 'running') return null;
  const items = turn.items || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'tool' && it.status === 'running') return { phase: 'tool', tool: it };
    if (it.kind === 'text' || it.kind === 'thinking') break;
  }
  const last = items[items.length - 1];
  if (!last) return { phase: turn.id ? 'thinking' : 'starting', tool: null };
  if (last.kind === 'thinking') return { phase: 'thinking', tool: null };
  if (last.kind === 'text' && !last.closed) return { phase: 'writing', tool: null };
  return { phase: 'thinking', tool: null };
}

/**
 * The turn's items cut into what a reader sees: prose, and runs of work between prose.
 *   [{ type: 'text', item }, { type: 'work', items: [...] }, ...]
 * A run of work is every call and thought between two pieces of prose.
 */
export function segments(turn) {
  const out = [];
  for (const it of (turn && turn.items) || []) {
    if (it.kind === 'text') {
      if (!it.text) continue;
      out.push({ type: 'text', item: it });
    } else {
      const last = out[out.length - 1];
      if (last && last.type === 'work') last.items.push(it);
      else out.push({ type: 'work', items: [it] });
    }
  }
  return out;
}

/** The plan as the turn last stated it, or null: the todo list of the latest planning call. */
export function latestPlan(turn, describe) {
  const items = (turn && turn.items) || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== 'tool' || toolKind(it.name) !== 'todo') continue;
    const d = describe(it.name, it.args);
    if (d.todos && d.todos.length) return d.todos;
  }
  return null;
}
