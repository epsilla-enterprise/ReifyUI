// The HarnessRouter transport, for apps served by the HarnessRouter console.
//
// A "kit" is a single-page app the console serves at /kits/<id>, same-origin with its API proxy.
// That origin is the whole authentication story: the console already signed the person in, the
// browser carries that session on every request, and the proxy attaches the internal key
// server-side. There is no token here, no login screen, and nothing to refresh.
//
// The model these functions speak:
//
//   a document   = a session on the kit's Harness   (the session list IS the document list)
//   its content  = a file in that session's workspace
//   talking to it= POST /responses with that session id
//
// Every route below is one the gateway actually implements. Keeping them in one file is the
// point: the first kit shipped five separate bugs that were all the same bug — a call carried
// over from a hosted product to an endpoint that does not exist here. A second kit copying this
// file would inherit the next five. Functions only, no hooks: a hook encodes page structure, and
// that genuinely differs per kit.
import { createResponsesDispatcher, readSSEStream } from '../stream/responses.js';

let CONFIG = { kitId: '', base: '/api/harness/v1' };

/** Call once at boot. kitId is what /v1/harnesses reports in `kit` for the harness this kit launched. */
export function configureKit({ kitId, base } = {}) {
  CONFIG = { kitId: kitId || CONFIG.kitId, base: base || CONFIG.base };
  _harness = null;
  return CONFIG;
}

export function kitConfig() { return { ...CONFIG }; }

async function readError(res) {
  try {
    const body = await res.json();
    const d = body?.error?.message ?? body?.detail;
    return typeof d === 'string' ? d : `request failed (${res.status})`;
  } catch {
    return `request failed (${res.status})`;
  }
}

/** One request. Throws an Error carrying `.status` so callers can branch on 409 / 404. */
export async function hr(path, init = {}) {
  const res = await fetch(`${CONFIG.base}${path}`, { cache: 'no-store', ...init });
  if (!res.ok) {
    const err = new Error(await readError(res));
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function jsonInit(method, body, headers) {
  return {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  };
}

// ── harnesses ──────────────────────────────────────────────────────────────
export async function listHarnesses() {
  const { harnesses = [] } = await hr('/harnesses');
  return harnesses;
}

let _harness = null;

/** The Harness this kit launched, or null when the kit was never launched.
 *
 *  Null is a real answer and callers must render it. Swallowing it into an empty list shows an
 *  empty "no documents yet" screen to someone whose actual problem is that nothing is running. */
export async function kitHarness() {
  if (_harness) return _harness;
  const harnesses = await listHarnesses();
  _harness = harnesses.find((h) => h.kit === CONFIG.kitId) || null;
  return _harness;
}

// ── sessions (= documents) ─────────────────────────────────────────────────
/** The kit's documents, newest first. The filter is `harness` — an unknown query param is
 *  ignored rather than refused, so the wrong name silently returns every session in the org. */
export async function listSessions({ limit = 100 } = {}) {
  const h = await kitHarness();
  if (!h) return { sessions: [], cursor: null };
  const body = await hr(`/sessions?harness=${encodeURIComponent(h.id)}&limit=${limit}`);
  return { sessions: body?.sessions ?? body?.data ?? [], cursor: body?.cursor ?? null };
}

export function sessionDetail(sid) {
  return hr(`/sessions/${encodeURIComponent(sid)}`);
}

/** Rename. This also rewrites the trace manifest the session LIST renders from, and marks the
 *  title as chosen so the next turn stops regenerating it from the latest user message. */
export function patchSession(sid, { title }) {
  return hr(`/sessions/${encodeURIComponent(sid)}`, jsonInit('PATCH', { title }));
}

/** Delete a document and the conversation underneath it. The route is /traces/{id}: there is no
 *  DELETE on the session path, and this one removes the trace, the durable workspace tarball and
 *  tombstones the session. */
export function deleteSession(sid) {
  return hr(`/traces/${encodeURIComponent(sid)}`, { method: 'DELETE' });
}

// ── workspace files ────────────────────────────────────────────────────────
/** Read one file by path, from the LIVE workspace — so a file appears the moment the agent
 *  writes it, mid-turn. Returns null when it does not exist yet.
 *
 *  Do not reach for the file LISTING to detect a file: that answers from the end-of-turn
 *  checkpoint tarball and shows a spinner over a file already on disk. */
export async function readFile(sid, path) {
  const r = await fetch(`${CONFIG.base}/sessions/${encodeURIComponent(sid)}/files/${path}`,
                        { cache: 'no-store' });
  if (!r.ok) return null;
  return r.text();
}

export async function readJsonFile(sid, path) {
  const text = await readFile(sid, path);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Write a workspace file. Refused 409 `session_busy` while that session has a turn running —
 *  the agent owns its workspace until it finishes. Blocking is honest; both sides silently
 *  racing is not. Callers must re-arm rather than drop the write. */
export function writeFile(sid, path, content) {
  return hr(`/sessions/${encodeURIComponent(sid)}/files/${path}`, jsonInit('PUT', { content }));
}

/** A URL that serves one artifact's bytes. Same-origin, so it works in <img src> directly. */
export function containerFileUrl(containerId, fileId) {
  return `${CONFIG.base}/containers/${encodeURIComponent(containerId)}`
       + `/files/${encodeURIComponent(fileId)}/content`;
}

// ── turns and responses ────────────────────────────────────────────────────
/** The conversation so far, oldest first. Replays from the trace WHILE a turn is in flight, so
 *  it is also how a reopened tab watches a running turn without a stream. */
export async function sessionTurns(sid, { limit } = {}) {
  const q = limit ? `?limit=${limit}` : '';
  const body = await hr(`/sessions/${encodeURIComponent(sid)}/turns${q}`).catch(() => null);
  return body?.turns ?? [];
}

export function getResponse(rid) {
  return hr(`/responses/${encodeURIComponent(rid)}`);
}

/** Start a turn.
 *
 *  idempotencyKey is not optional decoration for a background dispatch: without it a retry after
 *  a flaky reply starts a SECOND turn on a session that may already be running one, and two
 *  concurrent turns on one session destroy that session's workspace (each turn wipes and
 *  restores it, so the last writer wins with an empty tree). With the key, a duplicate replays
 *  the first response instead of running again. */
export function createResponse(body, { idempotencyKey, stream } = {}) {
  const headers = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (stream) headers.accept = 'text/event-stream';
  return hr('/responses', jsonInit('POST', body, headers));
}

/** Cancel one turn. Preferred over cancelling the session: it only kills the sandbox when it can
 *  prove this response owns the live turn, and otherwise lets the turn self-terminate. */
export function cancelResponse(rid) {
  return hr(`/responses/${encodeURIComponent(rid)}/cancel`, { method: 'POST' });
}

export function cancelSession(sid) {
  return hr(`/sessions/${encodeURIComponent(sid)}/cancel`, { method: 'POST' });
}

// ── streaming one turn ─────────────────────────────────────────────────────
/** Pull a session id out of whatever frame carries it, without caring which one that is. */
function sessionIdOf(evt) {
  return evt?.metadata?.session_id || evt?.response?.metadata?.session_id
      || evt?.session_id || evt?.response?.session_id || null;
}

/** Run one streaming turn against the kit's own harness.
 *
 *  `sessionId` may be empty for a brand-new document: nothing but a turn creates a session, so
 *  the id arrives in the stream and is reported through onSession before the frame is dispatched.
 *
 *  Framing belongs in `instructions`, never in `input`. The gateway captures the user text before
 *  it prepends instructions, so the transcript, the console task list and the trace all show the
 *  person's own sentence instead of our scaffolding.
 *
 *  handlers: the ReifyUI dispatcher's (onTextDelta, onReasoningDelta, onToolCall, onToolResult,
 *  onDone, onError) plus onSession(sessionId).
 *
 *  Returns {ok, sessionId}, or {connecting:true} when the gateway is still coming up (503).
 */
export async function streamTurn({ sessionId, harnessId, input, instructions, handlers = {} }) {
  let hid = harnessId;
  if (!hid) {
    const h = await kitHarness();
    if (!h) throw new Error('This kit has not been launched yet.');
    hid = h.id;
  }
  const existing = sessionId ? String(sessionId) : '';
  const res = await fetch(`${CONFIG.base}/responses`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      input,
      ...(instructions ? { instructions } : {}),
      metadata: { harness_id: hid, ...(existing ? { session_id: existing } : {}) },
      stream: true,
    }),
  });
  if (res.status === 503) return { connecting: true };
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`turn failed: ${res.status} ${t.slice(0, 160)}`);
  }

  let sawError = false;
  let sid = existing;
  const d = createResponsesDispatcher({
    ...handlers,
    onError: (msg) => { sawError = true; handlers.onError?.(msg); },
  });
  await readSSEStream(res.body, (data) => {
    let evt;
    try { evt = JSON.parse(data); } catch { return; }   // malformed frame
    const found = sessionIdOf(evt);
    if (found && found !== sid) { sid = found; handlers.onSession?.(found); }
    d.dispatch(evt);
  });
  return { ok: !sawError, sessionId: sid };
}

// ── replaying history ──────────────────────────────────────────────────────
// turnsToMessages now lives in state/turns.js and is re-exported from BOTH entry points: it is a
// pure shape translation, and ChatPanel (a root export) takes the messages it produces, so a root
// consumer must be able to convert history without pulling this fetch layer into its bundle.
export { turnsToMessages } from '../state/turns.js';

// Files on their way into a turn — `input_file` is this transport's block shape, so it lives here.
export { FILE_MAX, mimeOf, bufferToDataUrl, fileToInputBlock } from './attach.js';

/** The assistant text of a session's last turn — what a document page shows when there is no
 *  document yet and the agent has stopped. The real explanation is usually in there. */
export function lastAssistantText(turns) {
  for (let i = (turns || []).length - 1; i >= 0; i--) {
    if (turns[i]?.assistant) return String(turns[i].assistant);
  }
  return '';
}
