// Assistant-turn block state machine — extracted from HarnessRouter's workbench.
// An assistant turn is an ORDERED list of blocks appended as stream events arrive, so tool
// activity interleaves with prose in real time (never all tools hoisted to the top):
//   { kind: 'text',  text }                          — streamed prose
//   { kind: 'tools', reasoning, steps: ToolStep[] }  — a contiguous run of tool activity
// ToolStep: { name, args, result?, callId? }

export function withText(blocks, d) {
  const out = blocks.slice(); const last = out[out.length - 1];
  if (last && last.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + d };
  else out.push({ kind: 'text', text: d });
  return out;
}

export function withReasoning(blocks, d) {
  const out = blocks.slice(); const last = out[out.length - 1];
  if (last && last.kind === 'tools') out[out.length - 1] = { ...last, reasoning: last.reasoning + d };
  else out.push({ kind: 'tools', reasoning: d, steps: [] });
  return out;
}

export function withStep(blocks, step) {
  const out = blocks.slice(); const last = out[out.length - 1];
  if (last && last.kind === 'tools') out[out.length - 1] = { ...last, steps: [...last.steps, step] };
  else out.push({ kind: 'tools', reasoning: '', steps: [step] });
  return out;
}

export function withResult(blocks, callId, output) {
  return blocks.map((b) => (b.kind !== 'tools' ? b
    : { ...b, steps: b.steps.map((t) => ((t.callId && t.callId === callId && t.result === undefined) ? { ...t, result: output } : t)) }));
}

/** All prose of an assistant message joined (for copy-to-clipboard etc.). */
export function asstText(a) {
  return a.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n\n');
}
