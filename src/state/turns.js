// Gateway turns -> the message shape ChatMessages renders.
//
// This lives in state/ rather than in the transport because it is a pure shape translation with
// no network in it, and because ChatPanel (a root export) takes ChatMessage[] from its
// loadHistory: a root consumer must be able to convert history without pulling the whole
// HarnessRouter fetch layer into its bundle. reifyui/harness re-exports it, so the transport's
// own callers keep importing it from where the rest of their transport lives.
//
// Four apps had each open-coded this function. Three of the four copies were byte-identical and
// the fourth was the same logic with the status map inlined as a nested ternary.

const TURN_STATUS = {
  failed: 'failed', error: 'failed', cancelled: 'cancelled',
  incomplete: 'incomplete', max_turns: 'incomplete', timeout: 'incomplete',
};

/** Gateway turns -> ChatMessages' message shape. */
export function turnsToMessages(turns) {
  const out = [];
  for (const t of turns || []) {
    if (t.user) out.push({ role: 'user', text: t.user });
    const steps = (t.tools || []).map((x) => ({ name: x.name, args: x.arguments, result: x.result }));
    const blocks = [];
    if (steps.length) blocks.push({ kind: 'tools', reasoning: '', steps });
    if (t.assistant) blocks.push({ kind: 'text', text: t.assistant });
    const status = TURN_STATUS[t.status] || 'done';
    if (blocks.length || status !== 'done') out.push({ role: 'assistant', blocks, status });
  }
  return out;
}
