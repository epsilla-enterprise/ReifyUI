// The agent conversation, drawn the way Claude Code draws it: prose in full, work folded to one
// past-tense line per run of calls, every call one click from its whole input and output, and a
// single live line that says what is happening now, with the harness's own mark moving beside it.
//
// Components take plain data (a Turn, see turn.js) and callbacks. They fetch nothing.
//
// Components take one `props` object and destructure inside, so TypeScript hosts do not infer
// every optional slot as required (the convention of the rest of the package).
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { describeTool, toolLine, summarizeCalls, resultNote, parseToolArgs, browserElements } from './tools.js';
import { liveState, segments, latestPlan } from './turn.js';
import { formatElapsed, formatDuration, formatTokens, useElapsed } from './time.js';
import { Chevron, IcTerminal, IcDoc, IcScroll, IcSearch, IcGlobe, IcSpawn, IcList, IcSkill, IcPlug, IcTool, IcThink,
  IcSend, IcX, IcPaperclip } from '../components/icons.jsx';

export const DEFAULT_AGENT_LABELS = {
  starting: 'Starting',
  thinking: 'Thinking',
  writing: 'Writing',
  tool: 'Running a tool',
  thought: 'Thought',
  thoughtFor: (t) => `Thought for ${t}`,
  workedFor: (t) => `Worked for ${t}`,
  worked: 'Done',
  tokens: (n) => `${n} tokens`,
  stopped: 'Stopped',
  stoppedAfter: (t) => `Stopped after ${t}`,
  failed: 'Failed',
  failedAfter: (t) => `Failed after ${t}`,
  incomplete: 'Stopped before finishing',
  input: 'Input',
  output: 'Output',
  noOutput: 'No output',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Select and copy',
  moreLines: (n) => (n === 1 ? '+1 line' : `+${n} lines`),
  fewerLines: 'Show less',
  failedCalls: (n) => (n === 1 ? '1 failed' : `${n} failed`),
  stoppedCall: 'stopped',
  plan: 'Plan',
  jump: 'Jump to latest',
  send: 'Send',
  stop: 'Stop',
  stopping: 'Stopping',
  attach: 'Attach a file',
  remove: (name) => `Remove ${name}`,
  working: 'Working',
};

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
function cleanOutput(s) { return String(s ?? '').replace(ANSI, '').replace(/\r\n?/g, '\n'); }
function pretty(s) {
  const x = String(s || '').trim();
  if (!/^[[{]/.test(x)) return null;
  try { return JSON.stringify(JSON.parse(x), null, 2); } catch { return null; }
}
function firstLine(s, max = 220) {
  const l = cleanOutput(s).split('\n').map((x) => x.trim()).find(Boolean) || '';
  return l.length > max ? `${l.slice(0, max)}…` : l;
}
function cls(...xs) { return xs.filter(Boolean).join(' '); }

// ── the mark ──────────────────────────────────────────────────────────────────────────────────────

/** The harness's mark with its motion, or three jostling dots when there is no mark. */
export function WorkingMark(props) {
  const { mark, motion, size = 18, still = false } = props;
  const m = mark ? (motion || 'pulse') : 'dots';
  return (
    <span className={cls('uac-mark', still && 'is-still')} data-motion={m} style={{ '--uac-mark': `${size}px` }} aria-hidden="true">
      <span className="uac-mark-aura" />
      <span className="uac-mark-in">
        {mark || (<><i /><i /><i /></>)}
      </span>
    </span>
  );
}

/**
 * The live line: `[mark] 2s · Thinking`. `start` is the epoch ms the clock counts from (the send);
 * without one the line shows no time. `label` is what is happening now.
 */
export function WorkingIndicator(props) {
  const { mark, motion, start = null, end = null, label, onToggle, expanded, controls, className, shimmer = true, size } = props;
  const ms = useElapsed(start, end);
  const body = (
    <>
      <WorkingMark mark={mark} motion={motion} size={size} />
      {ms != null ? <span className="uac-elapsed" aria-hidden="true">{formatElapsed(ms)}</span> : null}
      {ms != null ? <span className="uac-sep" aria-hidden="true">·</span> : null}
      <span className={cls('uac-verb', shimmer && 'uac-shimmer')} data-text={label}>{label}</span>
      {onToggle ? <span className="uac-chev" aria-hidden="true"><Chevron dir={expanded ? 'down' : 'right'} size={12} /></span> : null}
    </>
  );
  if (onToggle) {
    return (
      <button type="button" className={cls('uac-working', 'is-button', className)} aria-expanded={!!expanded}
        aria-controls={controls} onClick={onToggle}>
        <span className="uac-sr" role="status">{label}</span>{body}
      </button>
    );
  }
  return <div className={cls('uac-working', className)}><span className="uac-sr" role="status">{label}</span>{body}</div>;
}

// ── small parts ───────────────────────────────────────────────────────────────────────────────────

export function CopyButton(props) {
  const { text, labels = DEFAULT_AGENT_LABELS, label } = props;
  const [state, setState] = useState('');
  useEffect(() => {
    if (!state) return undefined;
    const t = setTimeout(() => setState(''), 1600);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(text ?? ''));
      setState('ok');
    } catch {
      setState('no');
    }
  };
  const said = state === 'ok' ? labels.copied : state === 'no' ? labels.copyFailed : (label || labels.copy);
  return (
    <button type="button" className={cls('uac-copy', state && `is-${state}`)} onClick={copy} aria-label={label ? `${labels.copy} ${label}` : labels.copy}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {state === 'ok' ? <path d="M5 12l5 5L20 7" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>}
      </svg>
      <span>{said}</span>
    </button>
  );
}

export function DiffBadge(props) {
  const { diff } = props;
  if (!diff || (!diff.added && !diff.removed && diff.added !== 0)) return null;
  return (
    <span className="uac-diff" aria-label={`${diff.added} lines added, ${diff.removed} removed`}>
      <span className="uac-add">+{diff.added}</span><span className="uac-del">{'−'}{diff.removed}</span>
    </span>
  );
}

/** Lines, the first `limit` shown and the rest one click away. */
export function LinesBlock(props) {
  const { lines, limit = 12, labels = DEFAULT_AGENT_LABELS, className, numbered = false } = props;
  const [all, setAll] = useState(false);
  const more = Math.max(0, lines.length - limit);
  const shown = all || !more ? lines : lines.slice(0, limit);
  return (
    <div className={cls('uac-lines', className)}>
      <pre>{shown.map((l, i) => (
        <span key={i} className={cls('uac-ln', l.cls)}>{numbered ? <span className="uac-lno">{i + 1}</span> : null}{l.text || ' '}</span>
      ))}</pre>
      {more ? (
        <button type="button" className="uac-more" onClick={(e) => { e.stopPropagation(); setAll((v) => !v); }} aria-expanded={all}>
          {all ? labels.fewerLines : labels.moreLines(more)}
        </button>
      ) : null}
    </div>
  );
}

const asLines = (text, c) => String(text ?? '').replace(/\n$/, '').split('\n').map((t) => ({ text: t, cls: c }));

const KIND_ICON = { shell: IcTerminal, shell_output: IcTerminal, read: IcScroll, write: IcDoc, edit: IcDoc, search: IcSearch,
  glob: IcSearch, list: IcList, web_search: IcGlobe, web_fetch: IcGlobe, agent: IcSpawn, todo: IcList, skill: IcSkill,
  think: IcThink, toolsearch: IcSearch, browser: IcGlobe, mcp: IcPlug, tool: IcTool };

function StatusGlyph(props) {
  const { status, kind } = props;
  if (status === 'running') return <span className="uac-ring" aria-hidden="true" />;
  if (status === 'failed') return <span className="uac-x" aria-hidden="true"><IcX size={13} /></span>;
  if (status === 'stopped') return <span className="uac-stopped" aria-hidden="true" />;
  const Ic = KIND_ICON[kind] || IcTool;
  return <span className="uac-kind" aria-hidden="true"><Ic /></span>;
}

/** A call's input, in the shape a person reads: the command, the diff, `key: value` lines. */
function inputLines(d, item) {
  const a = parseToolArgs(item.args);
  if (d.kind === 'shell') {
    const cmd = d.mono ? d.target : (d.note || d.targetFull);
    const out = asLines(`$ ${cmd || ''}`, 'is-cmd');
    if (!d.mono && d.target) out.unshift({ text: d.target, cls: 'is-note' });
    return { lines: out, copy: cmd };
  }
  if ((d.kind === 'edit' || d.kind === 'write') && d.diff) {
    const lines = [];
    const path = d.targetFull;
    if (path) lines.push({ text: path, cls: 'is-path' });
    const edits = Array.isArray(a.edits) ? a.edits : [a];
    for (const e of edits) {
      const old = e.old_string ?? e.old_str ?? e.oldText ?? e.old_text;
      const neu = e.new_string ?? e.new_str ?? e.newText ?? e.new_text ?? e.content ?? e.file_text ?? e.contents;
      if (old != null && String(old)) lines.push(...asLines(old, 'is-del').map((l) => ({ ...l, text: `- ${l.text}` })));
      if (neu != null && String(neu)) lines.push(...asLines(neu, 'is-add').map((l) => ({ ...l, text: `+ ${l.text}` })));
    }
    const patch = a.patch ?? a.input ?? a._raw ?? a.diff;
    if (lines.length <= (path ? 1 : 0) && typeof patch === 'string') {
      for (const l of patch.split('\n')) lines.push({ text: l, cls: /^\+(?!\+\+)/.test(l) ? 'is-add' : /^-(?!--)/.test(l) ? 'is-del' : '' });
    }
    if (lines.length > (path ? 1 : 0)) return { lines, copy: typeof item.args === 'string' ? item.args : JSON.stringify(a, null, 2) };
  }
  if (a._raw != null) return { lines: asLines(a._raw), copy: a._raw };
  const keys = Object.keys(a);
  const flat = keys.length && keys.every((k) => a[k] == null || typeof a[k] !== 'object');
  if (flat) {
    const lines = [];
    for (const k of keys) {
      const v = a[k] == null ? '' : String(a[k]);
      const vs = v.split('\n');
      lines.push({ text: `${k}: ${vs[0]}`, cls: 'is-kv' });
      for (const more of vs.slice(1)) lines.push({ text: `  ${more}`, cls: 'is-kv' });
    }
    return { lines, copy: typeof item.args === 'string' ? item.args : JSON.stringify(a, null, 2) };
  }
  const js = keys.length ? JSON.stringify(a, null, 2) : '';
  return { lines: js ? asLines(js) : [], copy: js };
}

function StepDetail(props) {
  const { item, d, labels, id } = props;
  const input = inputLines(d, item);
  const out = item.output === undefined ? null : cleanOutput(item.output);
  const outPretty = out != null ? (pretty(out) || out) : null;
  return (
    <div className="uac-detail" id={id}>
      {input.lines.length ? (
        <section className="uac-sec">
          <header><span>{labels.input}</span><CopyButton text={input.copy} labels={labels} /></header>
          <LinesBlock lines={input.lines} limit={d.kind === 'write' || d.kind === 'edit' ? 24 : 12} labels={labels} />
        </section>
      ) : null}
      {outPretty != null ? (
        <section className={cls('uac-sec', item.status === 'failed' && 'is-failed')}>
          <header><span>{labels.output}</span>{outPretty ? <CopyButton text={outPretty} labels={labels} /> : null}</header>
          {outPretty.trim() ? <LinesBlock lines={asLines(outPretty)} labels={labels} /> : <p className="uac-none">{labels.noOutput}</p>}
          {item.truncated ? <p className="uac-none">{`${item.truncated} characters in all`}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * One call: what it did, to what, how it went; click for its whole input and output. A call the host
 * shows in a place of its own (`openStep` answers a handler for it: a browser step opens the browser
 * beside the conversation) opens there on a click instead, the way a file card opens its file.
 */
export function StepRow(props) {
  const { item, labels = DEFAULT_AGENT_LABELS, defaultOpen = false, element = null, openStep, active = false } = props;
  const d = useMemo(() => describeTool(item.name, item.args, { element }), [item.name, item.args, element]);
  const opener = openStep ? openStep(item, d) || null : null;
  const [open, setOpen] = useState(defaultOpen);
  const uid = useRef(`uac-s-${Math.random().toString(36).slice(2, 9)}`).current;
  const running = item.status === 'running';
  const runMs = useElapsed(running ? item.startedAt : null, null);
  const tookMs = !running && item.startedAt != null && item.endedAt != null ? item.endedAt - item.startedAt : null;
  const line = toolLine(d, running ? 'running' : 'done');
  const verb = running ? d.running : d.done;
  // split "Ran npm test" into the verb (quiet) and the target (ink), when the line is verb + target
  const hasTarget = d.target && line === `${verb} ${d.target}`;
  const note = !running && item.status !== 'failed' ? resultNote(d.kind, item.output) : '';
  const hasDetail = !opener && (!!(item.args && item.args !== '{}' && item.args !== '""') || item.output !== undefined);
  return (
    <div className={cls('uac-step', `is-${item.status}`, opener && 'is-opens', opener && active && 'is-active')} data-kind={d.kind}>
      <button type="button" className="uac-step-h" aria-expanded={hasDetail ? open : undefined} aria-controls={hasDetail ? uid : undefined}
        aria-current={opener && active ? 'true' : undefined}
        disabled={!opener && !hasDetail} onClick={opener || (() => setOpen((v) => !v))} title={d.targetFull || undefined}>
        <StatusGlyph status={item.status} kind={d.kind} />
        <span className="uac-step-t">
          {hasTarget ? (<><span className="uac-step-v">{verb}</span> <span className={cls('uac-step-o', d.mono && 'is-mono')}>{d.target}</span></>)
            : <span className={cls('uac-step-o', d.kind === 'shell' && d.mono && 'is-mono')}>{line}</span>}
          {d.note && d.kind === 'agent' ? <span className="uac-step-n">{d.note}</span> : null}
        </span>
        <DiffBadge diff={item.status === 'failed' ? null : d.diff} />
        {note ? <span className="uac-step-n">{note}</span> : null}
        {item.status === 'stopped' ? <span className="uac-step-n">{labels.stoppedCall}</span> : null}
        {running && runMs != null ? <span className="uac-step-time">{formatElapsed(runMs)}</span>
          : tookMs != null && tookMs >= 1000 ? <span className="uac-step-time">{formatDuration(tookMs)}</span> : null}
        {hasDetail || opener ? <span className="uac-chev" aria-hidden="true"><Chevron dir={open && !opener ? 'down' : 'right'} size={12} /></span> : null}
      </button>
      {item.status === 'failed' && item.output ? <div className="uac-step-err">{firstLine(item.output)}</div> : null}
      {open && hasDetail ? <StepDetail item={item} d={d} labels={labels} id={uid} /> : null}
    </div>
  );
}

/** A thought: "Thinking" while it streams, then "Thought for 6s", expandable to its words. */
export function ThinkingRow(props) {
  const { item, labels = DEFAULT_AGENT_LABELS } = props;
  const [open, setOpen] = useState(false);
  const uid = useRef(`uac-t-${Math.random().toString(36).slice(2, 9)}`).current;
  const live = item.open && item.endedAt == null;
  const ms = !live && item.startedAt != null && item.endedAt != null ? item.endedAt - item.startedAt : null;
  const label = live ? labels.thinking : ms != null && ms >= 1000 ? labels.thoughtFor(formatElapsed(ms)) : labels.thought;
  const has = !!String(item.text || '').trim();
  return (
    <div className={cls('uac-step', 'is-thought', live && 'is-running')}>
      <button type="button" className="uac-step-h" aria-expanded={has ? open : undefined} aria-controls={has ? uid : undefined}
        disabled={!has} onClick={() => setOpen((v) => !v)}>
        <span className="uac-kind" aria-hidden="true"><IcThink /></span>
        <span className="uac-step-t"><span className={cls('uac-step-v', live && 'uac-shimmer')} data-text={label}>{label}</span></span>
        {has ? <span className="uac-chev" aria-hidden="true"><Chevron dir={open ? 'down' : 'right'} size={12} /></span> : null}
      </button>
      {open && has ? <div className="uac-thought" id={uid}>{item.text}</div> : null}
    </div>
  );
}

function sumDiff(tools) {
  let added = 0; let removed = 0; let any = false;
  for (const t of tools) {
    if (t.status === 'failed') continue;
    const d = describeTool(t.name, t.args).diff;
    if (d) { any = true; added += d.added; removed += d.removed; }
  }
  return any ? { added, removed } : null;
}

/**
 * A run of work between two pieces of prose. Finished: one past-tense line ("Ran 3 commands, edited
 * app.ts +12 −4"), click for the calls. Live (the turn's last run while it works): the line IS the
 * live line, `[mark] 1m 4s · Running npm test`, and opens to the calls so far.
 */
export function WorkGroup(props) {
  const { items, live = false, liveLabel, start = null, mark, motion, labels = DEFAULT_AGENT_LABELS, defaultOpen = false,
    elements = null, openStep, activeStep = null } = props;
  const [open, setOpen] = useState(defaultOpen);
  const uid = useRef(`uac-g-${Math.random().toString(36).slice(2, 9)}`).current;
  const tools = items.filter((x) => x.kind === 'tool');
  const thoughts = items.filter((x) => x.kind === 'thinking');
  const failed = tools.filter((x) => x.status === 'failed').length;
  let summary = '';
  if (tools.length) summary = summarizeCalls(elements ? tools.map((t) => ({ name: t.name, args: t.args, element: elements[t.id] })) : tools);
  else if (thoughts.length) {
    const t = thoughts[0];
    const ms = t.startedAt != null && t.endedAt != null ? t.endedAt - t.startedAt : null;
    summary = ms != null && ms >= 1000 ? labels.thoughtFor(formatElapsed(ms)) : labels.thought;
  }
  const diff = sumDiff(tools);
  // a lone thought with nothing to read stays out of the way
  if (!live && !tools.length && !thoughts.some((t) => String(t.text || '').trim())) return null;
  const body = open ? (
    <div className="uac-calls" id={uid}>
      {items.map((it) => (it.kind === 'tool'
        ? <StepRow key={it.id} item={it} labels={labels} element={elements ? elements[it.id] || null : null}
            openStep={openStep} active={activeStep != null && activeStep === it.id} />
        : <ThinkingRow key={it.id} item={it} labels={labels} />))}
    </div>
  ) : null;
  if (live) {
    return (
      <div className={cls('uac-group', 'is-live', open && 'is-open')}>
        <WorkingIndicator mark={mark} motion={motion} start={start} label={liveLabel} onToggle={() => setOpen((v) => !v)}
          expanded={open} controls={uid} />
        {body}
      </div>
    );
  }
  return (
    <div className={cls('uac-group', open && 'is-open', failed && 'has-failed')}>
      <button type="button" className="uac-sum" aria-expanded={open} aria-controls={uid} onClick={() => setOpen((v) => !v)}>
        <span className="uac-sum-t">{summary}</span>
        <DiffBadge diff={diff} />
        {failed ? <span className="uac-fail-n">{labels.failedCalls(failed)}</span> : null}
        <span className="uac-chev" aria-hidden="true"><Chevron dir={open ? 'down' : 'right'} size={12} /></span>
      </button>
      {body}
    </div>
  );
}

/** The plan as the agent last stated it. */
export function TodoCard(props) {
  const { todos, labels = DEFAULT_AGENT_LABELS, running = false } = props;
  if (!todos || !todos.length) return null;
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <div className="uac-todo" role="group" aria-label={`${labels.plan}: ${done} of ${todos.length} done`}>
      {todos.map((t, i) => (
        <div key={i} className={cls('uac-todo-i', `is-${t.status}`, !running && t.status === 'in_progress' && 'is-held')}>
          <span className="uac-todo-m" aria-hidden="true">
            {t.status === 'completed' ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> : null}
          </span>
          <span className="uac-todo-t">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// ── prose ─────────────────────────────────────────────────────────────────────────────────────────

const REDUCED = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Streamed prose. Deltas arrive in bursts; the text is let out at a steady pace (faster as the
 * backlog grows) and its newest words fade in, so it reads as ink settling rather than as lumps.
 * Text present when it mounts is history and paints at once.
 */
export function StreamingText(props) {
  const { text, active, render } = props;
  const on = !!active && !REDUCED;
  const [n, setN] = useState(() => (text ? text.length : 0));
  const textRef = useRef(text);
  textRef.current = text;
  const acc = useRef(text ? text.length : 0);
  useEffect(() => {
    if (!on) { const l = textRef.current ? textRef.current.length : 0; acc.current = l; setN(l); return undefined; }
    let raf; let prev = null;
    const tick = (t) => {
      if (prev == null) prev = t;
      const dt = Math.min(0.1, (t - prev) / 1000);
      prev = t;
      const len = textRef.current ? textRef.current.length : 0;
      const gap = len - acc.current;
      if (gap > 0) {
        acc.current = Math.min(len, acc.current + Math.max(40, gap / 1.2) * dt);
        setN(Math.floor(acc.current));
      } else if (gap < 0) { acc.current = len; setN(len); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  const shown = on ? String(text || '').slice(0, n) : String(text || '');
  const rendering = on && n < String(text || '').length;
  return <div className={cls('uac-md', on && 'is-streaming', rendering && 'is-catching-up')}>{render ? render(shown) : <div className="uac-plain">{shown}</div>}</div>;
}

// ── the turn ──────────────────────────────────────────────────────────────────────────────────────

export function UserBubble(props) {
  const { user, renderFile, extra } = props;
  if (!user) return null;
  const files = user.files || [];
  return (
    <div className="uac-user">
      <div className="uac-user-b">
        {extra}
        {files.length ? (
          <div className="uac-user-files">
            {files.map((f, i) => {
              if (renderFile) return <React.Fragment key={i}>{renderFile(f, i)}</React.Fragment>;
              const img = f.src && (/^data:image\//.test(f.src) || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name || ''));
              return img ? <img key={i} className="uac-user-img" src={f.src} alt={f.name} />
                : <span key={i} className="uac-chip"><IcPaperclip size={12} /><span>{f.name}</span></span>;
            })}
          </div>
        ) : null}
        {user.text ? <div className="uac-user-t">{user.text}</div> : null}
      </div>
    </div>
  );
}

/** How the turn ended, from its own clocks and usage; nothing when neither is known. */
export function TurnOutcome(props) {
  const { turn, labels = DEFAULT_AGENT_LABELS, describeIncomplete } = props;
  if (!turn || turn.status === 'running') return null;
  const ms = turn.startedAt != null && turn.endedAt != null ? turn.endedAt - turn.startedAt : turn.elapsedMs;
  const time = ms != null && ms >= 0 ? formatElapsed(ms) : '';
  // every token the turn's usage reports: fresh input, output, and the cache read and written. Some
  // providers' total leaves the cache out (Anthropic's input counts fresh tokens only), so the
  // same work would read 300 on one harness and 13k on another.
  const u = turn.usage || null;
  const parts = u ? ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'].map((k) => Number(u[k]) || 0) : [];
  const tok = u ? (parts.some(Boolean) ? parts.reduce((a, b) => a + b, 0) : (Number(u.total_tokens) || 0)) : 0;
  const tokens = tok ? labels.tokens(formatTokens(tok)) : '';
  if (turn.status === 'done') {
    if (!time && !tokens) return null;
    return <div className="uac-outcome">{[time ? labels.workedFor(time) : labels.worked, tokens].filter(Boolean).join(' · ')}</div>;
  }
  if (turn.status === 'cancelled') {
    return <div className="uac-outcome is-stopped">{time ? labels.stoppedAfter(time) : labels.stopped}</div>;
  }
  if (turn.status === 'incomplete') {
    const why = describeIncomplete ? describeIncomplete(turn.incomplete || {}) : (turn.incomplete && turn.incomplete.detail) || '';
    return (
      <div className="uac-outcome is-incomplete">
        <span>{labels.incomplete}{time ? ` · ${time}` : ''}</span>
        {why ? <p className="uac-outcome-why">{why}</p> : null}
      </div>
    );
  }
  return (
    <div className="uac-outcome is-failed" role="status">
      <span>{time ? labels.failedAfter(time) : labels.failed}</span>
      {turn.error ? <p className="uac-outcome-why">{turn.error}</p> : null}
    </div>
  );
}

/**
 * One turn: the person's message, then what the agent did and said, in the order it happened, and
 * how it ended. While it runs, the last line is always what is happening now.
 */
export function AgentTurnView(props) {
  const {
    turn, renderMarkdown, mark, motion, labels: labelsIn, showUser = true, renderUserFile, userExtra,
    meta, renderFiles, actions, describeIncomplete, liveStart, openStep, activeStep = null,
  } = props;
  const labels = useMemo(() => ({ ...DEFAULT_AGENT_LABELS, ...(labelsIn || {}) }), [labelsIn]);
  // what each browser call acted on, read from the page snapshots before it in this turn
  const items = turn ? turn.items : null;
  const elements = useMemo(() => browserElements(items), [items]);
  if (!turn) return null;
  const running = turn.status === 'running';
  const segs = segments(turn);
  const plan = latestPlan(turn, describeTool);
  const now = liveState(turn);
  const start = liveStart ?? turn.startedAt;
  const lastSeg = segs[segs.length - 1];
  const liveWork = running && lastSeg && lastSeg.type === 'work';
  let liveLabel = labels.thinking;
  if (now) {
    if (now.phase === 'tool' && now.tool) liveLabel = toolLine(describeTool(now.tool.name, now.tool.args, { element: elements[now.tool.id] }), 'running');
    else if (now.phase === 'writing') liveLabel = labels.writing;
    else if (now.phase === 'starting') liveLabel = labels.starting;
  }
  const lastTextIdx = (() => { for (let i = segs.length - 1; i >= 0; i--) if (segs[i].type === 'text') return i; return -1; })();
  const files = renderFiles ? renderFiles(turn) : null;
  return (
    <article className={cls('uac-turn', `is-${turn.status}`)} data-status={turn.status}>
      {showUser ? <UserBubble user={turn.user} renderFile={renderUserFile} extra={userExtra} /> : null}
      <div className="uac-agent">
        {meta ? <div className="uac-meta">{meta}</div> : null}
        {segs.map((s, i) => {
          const isLive = liveWork && i === segs.length - 1;
          if (isLive) {
            return (
              <React.Fragment key={`w${i}`}>
                {plan ? <TodoCard todos={plan} labels={labels} running /> : null}
                <WorkGroup items={s.items} live liveLabel={liveLabel} start={start} mark={mark} motion={motion} labels={labels}
                  elements={elements} openStep={openStep} activeStep={activeStep} />
              </React.Fragment>
            );
          }
          if (s.type === 'text') {
            return <StreamingText key={s.item.id || `t${i}`} text={s.item.text} render={renderMarkdown}
              active={running && i === lastTextIdx && i === segs.length - 1} />;
          }
          return <WorkGroup key={`w${i}-${s.items[0] && s.items[0].id}`} items={s.items} labels={labels}
            elements={elements} openStep={openStep} activeStep={activeStep} />;
        })}
        {!liveWork && plan ? <TodoCard todos={plan} labels={labels} running={running} /> : null}
        {running && !liveWork ? <WorkingIndicator mark={mark} motion={motion} start={start} label={liveLabel} /> : null}
        {files}
        <TurnOutcome turn={turn} labels={labels} describeIncomplete={describeIncomplete} />
        {!running && actions ? <div className="uac-actions">{actions}</div> : null}
      </div>
    </article>
  );
}

// ── the composer ──────────────────────────────────────────────────────────────────────────────────

/**
 * The message box. While a task runs its button is Stop and Enter does not send (a second turn on a
 * running task is refused anyway); the box stays typable so the next message can be drafted.
 */
export function AgentComposer(props) {
  const {
    value, onChange, onSend, onStop, running = false, stopping = false, disabled = false, sendDisabled,
    placeholder, runningPlaceholder, attachments = [], onRemoveAttachment, onAttachFiles, accept, multiple = false,
    left, right, footer, inputId, inputRef, autoFocus, maxRows = 10, labels: labelsIn, ariaLabel, className,
  } = props;
  const labels = { ...DEFAULT_AGENT_LABELS, ...(labelsIn || {}) };
  const own = useRef(null);
  const ta = inputRef || own;
  const fileIn = useRef(null);
  const root = useRef(null);
  const [dropping, setDropping] = useState(false);
  const grow = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 22;
    const max = lh * maxRows + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [ta, maxRows]);
  useLayoutEffect(grow, [value, grow]);
  const blocked = sendDisabled ?? (!String(value || '').trim() && !attachments.length);
  const send = () => { if (!running && !disabled && !blocked) onSend && onSend(); };
  const files = (list) => { if (list && list.length && onAttachFiles) onAttachFiles(list); };
  return (
    <div ref={root} className={cls('uac-composer', running && 'is-running', dropping && 'is-dropping', disabled && 'is-disabled', className)}
      onDragOver={onAttachFiles ? (e) => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); setDropping(true); } } : undefined}
      onDragLeave={onAttachFiles ? (e) => { if (!root.current || !root.current.contains(e.relatedTarget)) setDropping(false); } : undefined}
      onDrop={onAttachFiles ? (e) => { if (e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); setDropping(false); files(e.dataTransfer.files); } } : undefined}>
      {attachments.length ? (
        <div className="uac-atts">
          {attachments.map((f, i) => (
            <span key={f.id || i} className={cls('uac-att', f.status && `is-${f.status}`)}>
              {f.src && /^(data:image\/|blob:)/.test(f.src) ? <img src={f.src} alt="" /> : <IcPaperclip size={13} />}
              <span className="uac-att-n">{f.name}</span>
              {onRemoveAttachment ? (
                <button type="button" aria-label={labels.remove(f.name)} onClick={() => onRemoveAttachment(i)}><IcX size={12} /></button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      <textarea id={inputId} ref={ta} rows={1} value={value} autoFocus={autoFocus} disabled={disabled}
        placeholder={running && runningPlaceholder ? runningPlaceholder : placeholder}
        aria-label={ariaLabel || placeholder}
        onChange={(e) => onChange && onChange(e.target.value)}
        onPaste={onAttachFiles ? (e) => { const fl = e.clipboardData && e.clipboardData.files; if (fl && fl.length) { e.preventDefault(); files(fl); } } : undefined}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || (e.nativeEvent && e.nativeEvent.isComposing)) return;
          e.preventDefault();
          send();
        }} />
      <div className="uac-composer-row">
        {onAttachFiles ? (
          <>
            <button type="button" className="uac-icon-btn" aria-label={labels.attach} title={labels.attach} disabled={disabled}
              onClick={() => fileIn.current && fileIn.current.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <input ref={fileIn} type="file" hidden accept={accept} multiple={multiple}
              onChange={(e) => { files(e.target.files); e.target.value = ''; }} />
          </>
        ) : null}
        {left}
        <span className="uac-composer-sp" />
        {right}
        {running ? (
          <button type="button" className="uac-send is-stop" aria-label={stopping ? labels.stopping : labels.stop} title={labels.stop}
            disabled={stopping || !onStop} onClick={() => onStop && onStop()}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
          </button>
        ) : (
          <button type="button" className="uac-send" aria-label={labels.send} title={labels.send} disabled={disabled || blocked} onClick={send}>
            <IcSend />
          </button>
        )}
      </div>
      {footer ? <div className="uac-composer-foot">{footer}</div> : null}
    </div>
  );
}

// ── the column ────────────────────────────────────────────────────────────────────────────────────

function nearestScroller(el) {
  let n = el && el.parentElement;
  while (n && n !== document.body && n !== document.documentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll|overlay)/.test(s.overflowY)) return n;
    n = n.parentElement;
  }
  return null;   // the window
}

/**
 * Follow the bottom of a growing conversation while the reader is at it; stop following the moment
 * they scroll up, and say so (`atBottom` false) so a "jump to latest" button can appear.
 * `scroller`: an element, or null to find the nearest scrolling ancestor of `contentRef` (or the
 * window). `anchorRef`: the element whose bottom edge is "the bottom" (default: the content), so a
 * conversation with more page below it (a side panel stacked under it on a phone) is followed to
 * its own end, not the page's. `followKey`: change it (a new turn sent) to snap back to the bottom.
 */
export function useStickToBottom(contentRef, opts = {}) {
  const { scroller = null, anchorRef = null, followKey, threshold = 80, enabled = true } = opts;
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const target = useRef(null);
  const resolve = useCallback(() => {
    target.current = scroller || (contentRef.current ? nearestScroller(contentRef.current) : null);
    return target.current;
  }, [scroller, contentRef]);
  // how far the anchor's bottom edge is below the bottom of what can be seen (<= 0: in view)
  const distance = () => {
    const a = (anchorRef && anchorRef.current) || contentRef.current;
    if (!a) return 0;
    const t = target.current;
    const viewBottom = t ? t.getBoundingClientRect().top + t.clientHeight : window.innerHeight;
    return a.getBoundingClientRect().bottom - viewBottom;
  };
  const toBottom = useCallback((smooth = false) => {
    const d = distance();
    if (Math.abs(d) < 1) return;
    const behavior = smooth && !REDUCED ? 'smooth' : 'auto';
    const t = target.current;
    if (t) t.scrollBy({ top: d, behavior });
    else window.scrollBy({ top: d, behavior });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled) return undefined;
    const t = resolve();
    const on = () => {
      const at = distance() < threshold;
      stick.current = at;
      setAtBottom(at);
    };
    const el = t || window;
    el.addEventListener('scroll', on, { passive: true });
    on();
    return () => el.removeEventListener('scroll', on);
  }, [enabled, resolve, threshold]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = contentRef.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return undefined;
    // A reader opening a call grows the content too; that is them reading, not the agent writing,
    // so growth right after their own click or key press never moves the view.
    let quietUntil = 0;
    const touched = () => { quietUntil = Date.now() + 600; };
    el.addEventListener('pointerdown', touched, true);
    el.addEventListener('keydown', touched, true);
    const ro = new ResizeObserver(() => {
      if (!target.current && scroller == null) resolve();
      if (Date.now() < quietUntil) {
        stick.current = distance() < threshold;
        setAtBottom(stick.current);
        return;
      }
      if (stick.current) toBottom(false);
    });
    ro.observe(el);
    return () => { ro.disconnect(); el.removeEventListener('pointerdown', touched, true); el.removeEventListener('keydown', touched, true); };
  }, [enabled, contentRef, toBottom, resolve, scroller, threshold]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled || followKey === undefined) return;
    resolve();
    stick.current = true;
    setAtBottom(true);
    toBottom(false);
  }, [followKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { atBottom, toBottom: () => { stick.current = true; setAtBottom(true); toBottom(true); } };
}

/**
 * The conversation column: turns that scroll, and a dock that does not (the composer, a notice).
 * mode 'pane' fills a box of fixed height and scrolls inside it; mode 'page' lives in a scrolling
 * page, fills the window below its top edge and pins its dock to the bottom of the window.
 */
export function AgentConversation(props) {
  const { children, composer, notice, running = false, mark, motion, mode = 'pane', followKey, labels: labelsIn, className, empty } = props;
  const labels = { ...DEFAULT_AGENT_LABELS, ...(labelsIn || {}) };
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const [scroller, setScroller] = useState(null);
  useLayoutEffect(() => { if (mode === 'pane') setScroller(scrollRef.current); }, [mode]);
  const { atBottom, toBottom } = useStickToBottom(contentRef, { scroller: mode === 'pane' ? scroller : null, followKey,
    anchorRef: mode === 'page' ? rootRef : null, enabled: mode === 'page' || !!scroller });
  // page mode: the column reaches the bottom of what its scroller shows (the window, or the
  // scrolling box it sits in), so a short conversation still has its dock at the foot of the screen
  // rather than under its last message
  useLayoutEffect(() => {
    if (mode !== 'page' || !rootRef.current) return undefined;
    const set = () => {
      const r = rootRef.current;
      if (!r) return;
      const sc = nearestScroller(r);
      const rect = r.getBoundingClientRect();
      const avail = sc
        ? sc.clientHeight - (rect.top - sc.getBoundingClientRect().top + sc.scrollTop)
        : window.innerHeight - (rect.top + window.scrollY);
      r.style.setProperty('--uac-fill', `${Math.max(240, Math.round(avail))}px`);
    };
    set();
    window.addEventListener('resize', set);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    if (ro && rootRef.current.parentElement) ro.observe(rootRef.current.parentElement);
    return () => { window.removeEventListener('resize', set); if (ro) ro.disconnect(); };
  }, [mode]);
  return (
    <div ref={rootRef} className={cls('uac-convo', `is-${mode}`, className)}>
      <div ref={scrollRef} className="uac-scroll">
        <div ref={contentRef} className="uac-thread">{children || empty}</div>
      </div>
      <div className="uac-dock">
        {!atBottom ? (
          <button type="button" className="uac-jump" aria-label={labels.jump} title={labels.jump} onClick={toBottom}>
            {running ? <WorkingMark mark={mark} motion={motion} size={16} /> : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
            )}
          </button>
        ) : null}
        {notice ? <div className="uac-notice">{notice}</div> : null}
        {composer}
      </div>
    </div>
  );
}
