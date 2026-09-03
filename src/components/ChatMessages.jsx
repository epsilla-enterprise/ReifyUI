// Message list — extracted from HarnessRouter's workbench conversation render.
// Messages:
//   { role: 'user', text, ... }
//   { role: 'assistant', blocks, status: 'running'|'done'|'failed'|'cancelled'|'incomplete', ... }
// Assistant blocks render in stream order so tool activity interleaves with prose.
//
// Override slots (all optional):
//   renderMarkdown(text)        markdown renderer for prose blocks (inject your ReactMarkdown;
//                               default is a plain pre-wrap div — the package has no deps)
//   renderMessage(m, i)         full custom render for a message (return undefined to fall through)
//   userExtras(m, i)            extra content INSIDE the user bubble, before the text
//                               (HR renders its attachment cards here)
//   workingExtra(m, i)          extra content on the live Working row (HR's Stop button)
//   assistantFooter(m, i)       content below a finished assistant turn (file cards, action row)
//   roleLabel(m, i)             small caption above a turn ("You", the agent's name); none by default
//   renderStep(step, j)         per-step override inside the activity timeline
//   statusLabels                terminal badge copy per status
//   workingLabel / toolLabels   live-indicator + timeline copy
import React from 'react';
import { ToolGroup } from './ToolSteps.jsx';

export const DEFAULT_STATUS_LABELS = {
  failed: '✕ Failed. See the output above for the reason',
  cancelled: '◼ Stopped by you',
  // Claims only what is true of every cause: an incomplete turn may have hit its step or time
  // budget, or been cut mid-flight (a replica restart under a live turn settles as incomplete).
  // Asserting "step or time limit" for all of them sent an operator debugging a limit that was
  // never reached. A host that knows the actual cause says so in its own chrome (statusLabels /
  // assistantFooter).
  incomplete: '◔ Stopped before finishing. Continue to resume',
};

const defaultMarkdown = (text) => <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;

// Reduced motion: the typewriter is motion — render streamed text directly.
const REDUCED_MOTION = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Typewriter reveal for the actively-streaming text block. Deltas arrive in ~1.2s bursts, so raw
// rendering makes short answers pop in whole. This fills characters at a deliberate pace: reveal
// the currently-pending text over ~REVEAL_SEC seconds, but never slower than MIN_CPS (so the last
// characters don't drag) — and because the rate is (gap / REVEAL_SEC), a newly-arrived batch grows
// the gap and automatically speeds the reveal to catch up. Snaps to full when streaming stops.
//
// The typewriter is a DELTA smoother, not an entrance animation: text already present at mount is
// history (e.g. opening a running session loads the turn's progress-so-far as one snapshot) and
// paints instantly — only text appended after mount animates. A turn started live in this tab
// mounts with empty text, so its stream animates exactly as before.
const REVEAL_SEC = 3;   // a pending burst fills over ~3s...
const MIN_CPS = 10;     // ...unless the tail is small, then at least this many chars/sec
function TypewriterText(props) {
  const { text, render } = props;
  const active = props.active && !REDUCED_MOTION;
  const [n, setN] = React.useState(() => (text ? text.length : 0));
  const textRef = React.useRef(text);
  textRef.current = text;
  const accRef = React.useRef(text ? text.length : 0);   // float char position (setN renders the floor)
  React.useEffect(() => {
    if (!active) { setN(textRef.current ? textRef.current.length : 0); return undefined; }
    let raf; let prev = null;
    const tick = (t) => {
      if (prev == null) prev = t;
      const dt = Math.min(0.1, (t - prev) / 1000);   // clamp dt so a backgrounded tab doesn't jump
      prev = t;
      const len = textRef.current ? textRef.current.length : 0;
      const gap = len - accRef.current;
      if (gap > 0) {
        const cps = Math.max(MIN_CPS, gap / REVEAL_SEC);   // bigger backlog -> faster reveal
        accRef.current = Math.min(len, accRef.current + cps * dt);
        setN(Math.floor(accRef.current));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  const shown = active ? (text || '').slice(0, n) : (text || '');
  return render(shown);
}

// NOTE: components take a single `props` object and destructure inside — TypeScript consumers
// (HR is TSX) infer inline-destructured JS props as REQUIRED, which would force every slot.
export function UserTurn(props) {
  const { msg, children, label } = props;
  const bubble = (
    <div className="wbx-bubble-user">
      {children}
      {msg.text && <div className="wbx-bubble-text">{msg.text}</div>}
    </div>
  );
  // With a caption, caption and bubble share one column so the caption's left edge is the
  // bubble's left edge (the design), while the column itself still sits at the trailing side.
  return (
    <div className="wbx-turn user">
      {label ? <div className="wbx-turn-body"><div className="wbx-role">{label}</div>{bubble}</div> : bubble}
    </div>
  );
}

export function AssistantTurn(props) {
  const {
    msg,
    renderMarkdown = defaultMarkdown,
    workingLabel = 'Working…',
    workingExtra,
    statusLabels = DEFAULT_STATUS_LABELS,
    renderStep,
    toolLabels,
    footer,
    label,
  } = props;
  return (
    <div className="wbx-turn asst">
      {label ? <div className="wbx-role">{label}</div> : null}
      {msg.blocks.map((b, bi) => (b.kind === 'tools'
        ? <ToolGroup key={bi} reasoning={b.reasoning} steps={b.steps}
            running={msg.status === 'running' && bi === msg.blocks.length - 1}
            renderStep={renderStep} {...(toolLabels || {})} />
        : <div key={bi} className="wbx-md"><TypewriterText text={b.text} render={renderMarkdown}
            active={msg.status === 'running' && bi === msg.blocks.length - 1} /></div>
      ))}
      {/* Live "working" indicator BELOW the last row for the whole running turn (not just before
          the first token) — long tool/think phases otherwise look frozen. */}
      {msg.status === 'running' && (
        <div className="wbx-working" aria-label="Working">
          <span className="wbx-working-dots"><span /><span /><span /></span>
          <span className="wbx-working-txt">{workingLabel}</span>
          {workingExtra}
        </div>
      )}
      {(msg.status === 'failed' || msg.status === 'cancelled' || msg.status === 'incomplete') && (
        <div className={'wbx-turnbadge ' + msg.status} role="status">{statusLabels[msg.status]}</div>
      )}
      {footer}
    </div>
  );
}

// Loading placeholder for the conversation. Mirrors UserTurn/AssistantTurn geometry
// exactly (same .wbx-turn / .wbx-bubble-user / .wbx-md classes), so when real history
// streams in it lands with ZERO layout shift — assistant turns are full-width prose
// lines, user turns are right-aligned brand-tinted bubbles a fraction of the column.
// Themeable through the same --uic-* tokens as the live surface (light + dark), and
// the wrapper is display:contents so the turns inherit the consumer's own inter-turn
// spacing. Use on any conversational surface while history / the first tokens load:
//   {loading ? <ChatMessagesSkeleton /> : <ChatMessages ... />}
// Pass `turns` to customize the mix (each {role:'user'|'assistant', lines:[widths],
// width?} — user `width` is the bubble's fraction of the column).
const DEFAULT_SKELETON_TURNS = [
  { role: 'assistant', lines: ['94%', '82%', '58%'] },
  { role: 'user', width: '46%', lines: ['88%', '62%'] },
  { role: 'assistant', lines: ['90%', '97%', '71%'] },
  { role: 'user', width: '38%', lines: ['80%'] },
];

export function ChatMessagesSkeleton(props) {
  const turns = (props && props.turns) || DEFAULT_SKELETON_TURNS;
  return (
    <div className="wbx-skel" aria-busy="true" aria-label="Loading conversation">
      {turns.map((t, i) => (t.role === 'user' ? (
        <div key={i} className="wbx-turn user wbx-skel-turn" aria-hidden="true">
          <div className="wbx-bubble-user wbx-skel-lines" style={{ width: t.width }}>
            {t.lines.map((w, j) => <span key={j} className="wbx-skel-bar" style={{ width: w }} />)}
          </div>
        </div>
      ) : (
        <div key={i} className="wbx-turn asst wbx-skel-turn" aria-hidden="true">
          <div className="wbx-md wbx-skel-lines">
            {t.lines.map((w, j) => <span key={j} className="wbx-skel-bar" style={{ width: w }} />)}
          </div>
        </div>
      )))}
    </div>
  );
}

export function ChatMessages(props) {
  const {
    messages,
    renderMarkdown,
    renderMessage,
    userExtras,
    workingExtra,
    assistantFooter,
    statusLabels,
    renderStep,
    workingLabel,
    toolLabels,
    roleLabel,
  } = props;
  return (
    <>
      {messages.map((m, i) => {
        if (renderMessage) {
          const el = renderMessage(m, i);
          if (el !== undefined) return <React.Fragment key={i}>{el}</React.Fragment>;
        }
        return m.role === 'user' ? (
          <UserTurn key={i} msg={m} label={roleLabel?.(m, i)}>{userExtras?.(m, i)}</UserTurn>
        ) : (
          <AssistantTurn key={i} msg={m}
            renderMarkdown={renderMarkdown}
            workingLabel={workingLabel}
            workingExtra={workingExtra?.(m, i)}
            statusLabels={statusLabels}
            renderStep={renderStep}
            toolLabels={toolLabels}
            label={roleLabel?.(m, i)}
            footer={assistantFooter?.(m, i)} />
        );
      })}
    </>
  );
}
