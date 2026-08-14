// ChatPanel — the whole conversational column beside a document: header, history, live turn,
// connecting/retry state, attachments, dictation, composer.
//
// This existed four times (273 / 336 / 350 / 333 lines) in four products, and every copy had
// drifted: one shipped a disabled paperclip labelled "coming soon", three shipped a disabled
// microphone, one never showed that a turn was running when the turn had been started somewhere
// else, one dropped its staged files before checking whether the send would even happen, and one
// decided whether a session id was "real" by looking for the prefix "new:" in it.
//
// What is HERE is what is the same in all four: the state machine of a conversation.
// What stays with the CALLER is everything that differs — the transport, the product's prose,
// and where the panel sits in the page:
//
//   runTurn      run one turn and report it through `handlers`. The panel does not know whether
//                that is one stream, a stream with a fallback, or three requests.
//   loadHistory  the conversation so far, already as ChatMessage[]. Callers write
//                `.then(turnsToMessages)`; a caller whose brand-new document has no session
//                short-circuits to [] here and never makes the request. The panel treats the
//                session id as opaque and never parses it, which is what makes that possible.
//
// The panel owns `busy` (its own turn is in flight) and takes `externalBusy` (a turn is running
// that this tab did not start — another window, or the very first turn before the session is
// queryable). While externalBusy is true and there is nothing local, it polls history so the
// conversation appears, and when it goes false it reloads once so the final answer lands. A
// panel that ignores externalBusy shows a blank "describe what you want" prompt while the agent
// is visibly working, which is what one of the four copies did.
//
// Session ids: a document created from a landing page has no session until the first turn opens
// one, so `sessionId` can change mid-stream from the caller's placeholder to the real id. That is
// the same conversation renaming itself, not a reason to refetch over blocks arriving live — see
// the adopt guard below.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessages, ChatMessagesSkeleton } from './ChatMessages.jsx';
import { Composer } from './Composer.jsx';
import { Chip } from './Chip.jsx';
import { IcMic, IcPanelRight, IcPaperclip, IcSend } from './icons.jsx';
import { withReasoning, withResult, withStep, withText } from '../state/blocks.js';
import { bytesLabel } from '../format.js';

// Not props. Every one of the four copies used these exact numbers, so there is nothing to
// configure — a knob nobody turns is a knob that only makes the call sites longer.
const POLL_MS = 3000;      // catch-up poll while a turn runs elsewhere
const RETRY_MS = 20000;    // resend a message the gateway was not up to receive
const PIN_PX = 80;         // "close enough to the bottom" to keep following the stream

// ChatPanel's own defaults, NOT the package's DEFAULT_STATUS_LABELS. All four panels overrode
// that export with these sentences; promoting them into the export would silently rewrite the
// badges of every other consumer, which none of them asked for.
const PANEL_STATUS_LABELS = {
  failed: 'This turn failed. Please try again.',
  cancelled: 'Stopped',
  incomplete: 'The turn hit its limit. Send a follow up to continue.',
};

export function ChatPanel(props) {
  const {
    sessionId,
    runTurn,
    loadHistory,
    onSessionStarted,
    onChanged,

    seed = '',
    onSeedConsumed,

    externalBusy = false,

    attachments = null,
    dictation = null,

    title = '',
    headerRight = null,
    collapsed = false,
    onToggleCollapse,
    width,

    placeholder = 'Message',
    emptyState = null,
    busyState,
    connectingLabel = 'connecting',
    connectingNote = 'Still connecting. Your message will be sent as soon as it is online.',
    workingLabel = 'Working…',
    statusLabels = PANEL_STATUS_LABELS,
    renderMarkdown,
    userExtras,
    toolLabels,
    classNames = {},
  } = props;

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [histLoading, setHistLoading] = useState(true);
  const [staged, setStaged] = useState([]);      // files picked, not yet sent
  const [attachErr, setAttachErr] = useState('');
  const [listening, setListening] = useState(false);

  const pendingRef = useRef(null);               // { text, files } awaiting a live gateway
  const seededRef = useRef(false);
  const adoptedRef = useRef(null);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const pinnedRef = useRef(true);
  const prevExternalBusyRef = useRef(false);
  const prevIdRef = useRef(sessionId);

  // The callbacks arrive as fresh arrow functions on every render of the page, so they cannot be
  // effect dependencies without re-running the history load on every keystroke. Reading them
  // through a ref keeps the effects keyed on the things that actually changed (the session, the
  // busy flags) while still calling the CURRENT function.
  const api = useRef(null);
  api.current = { runTurn, loadHistory, onSessionStarted, onChanged, onSeedConsumed };

  // Stop listening when the panel goes away — the recogniser keeps the microphone otherwise.
  // Build `dictation` ONCE at the call site (useState(() => createDictation())): a fresh object
  // per render would stop the recogniser on every keystroke.
  useEffect(() => () => dictation?.stop(), [dictation]);

  // ── the message list ──────────────────────────────────────────────────────
  function updateLastAsst(fn) {
    setMessages((m) => {
      const out = m.slice();
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (out[i].role === 'assistant') { out[i] = fn({ ...out[i] }); break; }
      }
      return out;
    });
  }

  function dropRunningAsst() {
    setMessages((m) => (m.length && m[m.length - 1].role === 'assistant' && m[m.length - 1].status === 'running'
      ? m.slice(0, -1) : m));
  }

  // Follow the stream only when the reader is already at the bottom. Measured on scroll rather
  // than after the update, because by then the new content has already grown the distance.
  const onBodyScroll = () => {
    const el = bodyRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_PX;
  };
  useEffect(() => {
    const el = bodyRef.current;
    if (el && pinnedRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages, connecting, histLoading]);

  // ── running a turn ────────────────────────────────────────────────────────
  const deliver = useCallback(async (text, files = []) => {
    setBusy(true);
    setMessages((m) => [...m, { role: 'assistant', blocks: [], status: 'running' }]);
    try {
      const out = await api.current.runTurn({
        sessionId,
        text,
        attachments: files,
        handlers: {
          onSession: (sid) => {
            // Arm the adopt guard only when the id is genuinely CHANGING: a session reporting
            // the id it already has is not a rename and must not suppress a later reload.
            if (sid && sid !== sessionId) adoptedRef.current = sid;
            api.current.onSessionStarted?.(sid);
          },
          onReasoningDelta: (d) => updateLastAsst((a) => ({ ...a, blocks: withReasoning(a.blocks, d) })),
          onToolCall: (name, args, callId) => updateLastAsst((a) => ({ ...a, blocks: withStep(a.blocks, { name, args, callId }) })),
          onToolResult: (callId, output) => updateLastAsst((a) => ({ ...a, blocks: withResult(a.blocks, callId, output) })),
          onTextDelta: (d) => updateLastAsst((a) => ({ ...a, blocks: withText(a.blocks, d) })),
          onDone: (status) => updateLastAsst((a) => ({ ...a, status: status === 'completed' ? 'done' : status })),
          onError: () => updateLastAsst((a) => ({
            ...a,
            blocks: a.blocks.length ? a.blocks : withText([], 'Something went wrong. Please try again.'),
            status: 'failed',
          })),
        },
      }) || {};
      if (out.connecting) {
        // Not a failure: the gateway is still coming up. Take the turn back off the list and
        // hold the message — including its files — for the retry.
        dropRunningAsst();
        pendingRef.current = { text, files };
        setConnecting(true);
        return;
      }
      pendingRef.current = null;
      setConnecting(false);
      updateLastAsst((a) => (a.status === 'running' ? { ...a, status: 'done' } : a));
      api.current.onChanged?.();
    } catch {
      dropRunningAsst();
      pendingRef.current = { text, files };
      setConnecting(true);
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  const preparing = staged.some((f) => f.pending);
  const sendBlocked = busy || histLoading || preparing;

  function send() {
    const t = draft.trim();
    // The guard comes FIRST. One copy cleared its staged files above this line, so a send that
    // was refused (mid-turn, or with an empty box) silently threw the attachments away.
    if (!t || sendBlocked) return;
    // Sending ends the utterance: dictation is hands-free, and a recogniser still listening after
    // the message has gone types the next sentence into an empty box the person is not looking at.
    if (listening) { dictation?.stop(); setListening(false); }
    const files = staged;
    // The names ride on the message so the bubble shows what was sent with it. They are not
    // replayed from history — the transcript stores the person's text, not the files — so this is
    // what was attached in this session, not a claim about every past turn.
    setMessages((m) => [...m, { role: 'user', text: t, files: files.map((f) => f.name) }]);
    setDraft('');
    setStaged([]);
    setAttachErr('');
    deliver(t, files);
  }

  // ── history ───────────────────────────────────────────────────────────────
  // Keyed on sessionId. A placeholder id resolving to the real one is the SAME conversation, and
  // refetching there would setMessages() over blocks arriving live — the panel would show the
  // user's bubble and nothing else while the agent was visibly working. We know it is the same
  // conversation because our own stream just told us so.
  //
  // The guard is consumed on every run, not just the matching one: coming BACK to this id later
  // is a real reason to reload, and a guard that is never cleared would skip that too.
  useEffect(() => {
    const adopted = adoptedRef.current;
    adoptedRef.current = null;
    if (adopted && adopted === sessionId) { prevIdRef.current = sessionId; return undefined; }

    // A different document: drop the previous conversation instead of leaving it on screen
    // under a new title until (and only if) the new one turns out to be non-empty.
    if (prevIdRef.current !== sessionId) {
      prevIdRef.current = sessionId;
      setMessages([]);
      setHistLoading(true);
      setStaged([]);
      setAttachErr('');
      // A different document gets its own first message. The once-only latch is about not
      // resending THIS document's seed, not about one seed per panel for all time.
      seededRef.current = false;
    }

    // Fired before the await so the caller can strip ?seed= from the URL immediately — a refresh
    // or a back-button must never resend it. It fires whenever a seed was supplied, including
    // when history turns out to be non-empty and the seed is therefore skipped: making the URL
    // non-replayable is the point, and it is not conditional on the send.
    if (seed) api.current.onSeedConsumed?.();

    let dead = false;
    Promise.resolve(api.current.loadHistory(sessionId)).then((hist) => {
      if (dead) return;
      if (hist?.length) setMessages(hist);
      setHistLoading(false);
      if (seed && !seededRef.current && !hist?.length) {
        seededRef.current = true;
        setMessages([{ role: 'user', text: seed }]);
        deliver(seed);
      }
    }).catch(() => { if (!dead) setHistLoading(false); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Retry a message the gateway was not up to receive.
  useEffect(() => {
    if (!connecting) return undefined;
    const iv = window.setInterval(() => {
      const p = pendingRef.current;
      if (p && !busy) deliver(p.text, p.files);
    }, RETRY_MS);
    return () => window.clearInterval(iv);
  }, [connecting, busy, deliver]);

  // A turn may be running that this tab did not start. While that is true and nothing local is
  // streaming, poll history so its messages appear; when it ends, reload once so the final answer
  // and whatever it changed land here without a refresh.
  useEffect(() => {
    let dead = false;
    let poll;
    const reload = () => Promise.resolve(api.current.loadHistory(sessionId)).then((hist) => {
      // Never clobber a turn streaming in THIS tab, or a message still waiting to be sent.
      if (!dead && hist?.length && !busy && !pendingRef.current) setMessages(hist);
    }).catch(() => {});
    if (externalBusy && messages.length === 0 && !busy) poll = window.setInterval(reload, POLL_MS);
    if (prevExternalBusyRef.current && !externalBusy) {
      reload();
      api.current.onChanged?.();
    }
    prevExternalBusyRef.current = externalBusy;
    return () => { dead = true; if (poll) window.clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalBusy, messages.length, busy, sessionId]);

  // ── attachments ───────────────────────────────────────────────────────────
  // Each file appears immediately as a pending chip and resolves in place. prepare() is a real
  // wait — a network upload for one product, base64 of up to 25 MB for another — and a picker
  // that looks inert for three seconds is how people pick the same file twice.
  function pick(list) {
    if (!attachments?.prepare) return;
    setAttachErr('');
    for (const file of list) {
      const entry = { name: file.name, size: file.size, pending: true };
      setStaged((cur) => [...cur, entry]);
      Promise.resolve(attachments.prepare(file)).then((ready) => {
        setStaged((cur) => cur.map((s) => (s === entry ? { name: entry.name, size: entry.size, ...ready } : s)));
      }).catch((e) => {
        // Drop the chip and say why on its own line. The alternative one copy shipped — leaving a
        // chip named "(failed) report.pdf" in the row — looks like a file that is going to be sent.
        setStaged((cur) => cur.filter((s) => s !== entry));
        setAttachErr(e?.message || `${file.name} could not be attached.`);
      });
    }
  }

  function toggleDictation() {
    if (!dictation) return;
    if (listening) { dictation.stop(); setListening(false); return; }
    setListening(true);
    dictation.start({
      onText: (text) => setDraft((cur) => (cur ? `${cur.replace(/\s+$/, '')} ${text}` : text)),
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
  }

  // ── render ────────────────────────────────────────────────────────────────
  const rootCls = ['uic-chat', collapsed ? 'is-collapsed' : '', classNames.root || '']
    .filter(Boolean).join(' ');
  const toggle = onToggleCollapse ? (
    <button type="button" className="uic-panel-toggle" onClick={onToggleCollapse}
            title={collapsed ? 'Show the conversation' : 'Hide the conversation'}
            aria-label={collapsed ? 'Show the conversation' : 'Hide the conversation'}
            aria-expanded={!collapsed}>
      <IcPanelRight />
    </button>
  ) : null;

  if (collapsed) {
    return (
      <aside className={rootCls}>
        <div className="uic-chat-h">{toggle}</div>
      </aside>
    );
  }

  const empty = messages.length === 0;
  const attachControl = attachments ? (
    <>
      <input ref={fileRef} type="file" hidden
             accept={attachments.accept}
             multiple={attachments.multiple !== false}
             onChange={(e) => { pick([...e.target.files]); e.target.value = ''; }} />
      <button type="button" className="uic-chat-icon" aria-label="Attach a file"
              disabled={busy} onClick={() => fileRef.current?.click()}>
        <IcPaperclip />
      </button>
    </>
  ) : null;
  // No control for a capability we do not have: `dictation` is null wherever the browser has no
  // recogniser, and then there is no microphone at all — never a disabled one.
  const micControl = dictation ? (
    <button type="button" className={'uic-chat-icon' + (listening ? ' is-on' : '')}
            aria-label={listening ? 'Stop dictating' : 'Dictate'} aria-pressed={listening}
            disabled={busy} onClick={toggleDictation}>
      <IcMic />
    </button>
  ) : null;
  const defaultBusyState = (
    <div className="uic-chat-empty">
      <span className="uic-chat-pulse" aria-hidden="true" />
      <div className="uic-chat-empty-t">{workingLabel}</div>
    </div>
  );

  return (
    <aside className={rootCls} style={width ? { flex: `0 0 ${width}px` } : undefined}>
      <div className="uic-chat-h">
        {toggle}
        {title ? <span className="uic-chat-title" title={title}>{title}</span> : null}
        {headerRight}
        {connecting ? <span className="uic-chat-conn">{connectingLabel}</span> : null}
      </div>

      <div className="uic-chat-body" ref={bodyRef} onScroll={onBodyScroll} role="log" aria-live="polite">
        {histLoading ? <ChatMessagesSkeleton />
          : empty && externalBusy ? (busyState === undefined ? defaultBusyState : busyState)
          : empty ? emptyState
          : (
            <ChatMessages
              messages={messages}
              renderMarkdown={renderMarkdown}
              // The caller's slot falls through to the built-in file chips when it returns
              // undefined, the same contract ChatMessages already uses for renderMessage.
              userExtras={(m, i) => {
                const own = userExtras?.(m, i);
                if (own !== undefined) return own;
                if (!m.files?.length) return undefined;
                return (
                  <span className="uic-chat-msg-files">
                    {m.files.map((n) => (
                      <Chip key={n} icon={<IcPaperclip size={11} />} label={n} title={n} />
                    ))}
                  </span>
                );
              }}
              workingLabel={workingLabel}
              // All four panels wrote the same string twice, because ToolGroup carries its own
              // default. One label, one place.
              toolLabels={{ workingLabel, ...(toolLabels || {}) }}
              statusLabels={statusLabels}
            />
          )}
        {connecting ? (
          <div className="uic-chat-note" role="status">
            <span className="uic-chat-dot" aria-hidden="true" />
            {connectingNote}
          </div>
        ) : null}
      </div>

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        disabled={histLoading}
        sendDisabled={sendBlocked || !draft.trim()}
        placeholder={placeholder}
        rows={2}
        autoGrow={false}
        classNames={{ root: 'uic-chat-cmp', input: 'uic-chat-cmp-input', row: 'uic-chat-cmp-row' }}
        attachments={(staged.length > 0 || attachErr) ? (
          <div className="uic-chat-files">
            {staged.map((f, i) => (
              <Chip
                key={`${f.name}-${i}`}
                icon={<IcPaperclip size={11} />}
                title={f.name}
                label={<>
                  <span className="uic-chip-t">{f.name}</span>
                  <span className="uic-chip-meta">{f.pending ? '…' : bytesLabel(f.size)}</span>
                </>}
                onRemove={() => setStaged((c) => c.filter((_, j) => j !== i))}
                removeLabel={`Remove ${f.name}`}
              />
            ))}
            {attachErr ? <span className="uic-chat-file-err">{attachErr}</span> : null}
          </div>
        ) : null}
        accessoriesLeft={attachControl}
        accessoriesRight={micControl}
        renderSend={() => (
          <button type="button" className="uic-chat-send" onClick={send}
                  disabled={sendBlocked || !draft.trim()} aria-label="Send message">
            <IcSend />
          </button>
        )}
      />
    </aside>
  );
}
