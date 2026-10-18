// What a reader sees, rendered to markup (react-dom/server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentTurnView, AgentComposer, AgentConversation, WorkingIndicator, newTurn, reduceTurn } from '../src/agent-chat/index.js';
import * as root from '../src/index.js';

const j = (o) => JSON.stringify(o);
const callEvs = (oi, id, name, args) => [
  { type: 'response.output_item.added', output_index: oi, item: { id: `f${oi}`, type: 'function_call', call_id: id, name, arguments: '' } },
  { type: 'response.function_call_arguments.done', item_id: `f${oi}`, output_index: oi, arguments: args },
];
const out = (oi, id, output, extra = {}) => ({ type: 'response.output_item.added', output_index: oi, item: { type: 'function_call_output', call_id: id, output, ...extra } });
function build(steps, start = 0) {
  let t = newTurn({ user: { text: 'Fix the bug' }, startedAt: start });
  t = reduceTurn(t, { type: 'response.created', response: { id: 'r1' } }, start + 1);
  for (const [at, ev] of steps) for (const e of [].concat(ev)) t = reduceTurn(t, e, at);
  return t;
}
const html = (el) => renderToStaticMarkup(el);
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('a running turn: the live line names the call and moves the harness mark', () => {
  const t = build([[10, callEvs(0, 'c1', 'Bash', j({ command: 'npm test' }))]]);
  const h = html(<AgentTurnView turn={t} mark={<img src="/logos/claude.png" alt="" />} motion="bloom" />);
  assert.match(h, /data-motion="bloom"/);
  assert.match(text(h), /Running npm test/);
  assert.match(h, /aria-expanded="false"/, 'the live line opens to the calls so far');
  assert.match(text(h), /Fix the bug/);
});

test('a running turn with nothing yet says Thinking, with dots when there is no mark', () => {
  const h = html(<AgentTurnView turn={build([])} />);
  assert.match(text(h), /Thinking/);
  assert.match(h, /data-motion="dots"/);
});

test('finished work folds to one past-tense line with what it changed', () => {
  const t = build([
    [10, callEvs(0, 'a', 'Bash', j({ command: 'ls' }))], [20, out(1, 'a', 'x')],
    [30, callEvs(2, 'b', 'Bash', j({ command: 'pwd' }))], [40, out(3, 'b', '/w')],
    [50, callEvs(4, 'c', 'Edit', j({ file_path: 'src/app.ts', old_string: 'a', new_string: 'a\nb\nc' }))], [60, out(5, 'c', 'ok')],
    [70, [{ type: 'response.output_item.added', output_index: 6, item: { id: 'm', type: 'message', content: [] } }, { type: 'response.output_text.delta', item_id: 'm', output_index: 6, delta: 'Fixed.' }]],
    [64000, { type: 'response.completed', response: { status: 'completed', usage: { total_tokens: 12345 } } }],
  ]);
  const h = html(<AgentTurnView turn={t} />);
  const s = text(h);
  assert.match(s, /Ran 2 commands, edited a file/);
  assert.match(s, /\+3/);
  assert.match(s, /Worked for 1m 4s · 12\.3k tokens/);
  assert.match(s, /Fixed\./);
  assert.doesNotMatch(s, /Thinking/);
});

test('a failed call says so and shows its error line without a click', () => {
  const t = build([[10, callEvs(0, 'a', 'Bash', j({ command: 'ls /nope' }))], [20, out(1, 'a', 'ls: /nope: No such file or directory', { is_error: true })],
    [30, { type: 'response.completed', response: { status: 'completed' } }]]);
  const s = text(html(<AgentTurnView turn={t} />));
  assert.match(s, /1 failed/);
});

test('the plan renders once, as the agent last stated it', () => {
  const t = build([[10, callEvs(0, 'a', 'TodoWrite', j({ todos: [{ content: 'Read the code', status: 'completed' }, { content: 'Fix it', status: 'in_progress' }] }))], [11, out(1, 'a', 'ok')]]);
  const h = html(<AgentTurnView turn={t} />);
  assert.equal((h.match(/class="uac-todo"/g) || []).length, 1);
  assert.match(h, /is-completed/);
  assert.match(h, /is-in_progress/);
});

test('stopped and failed turns end in plain words', () => {
  const stopped = build([[3000, { type: 'response.failed', response: { status: 'cancelled' } }]]);
  assert.match(text(html(<AgentTurnView turn={stopped} />)), /Stopped after 3s/);
  const failed = build([[10, { type: 'error', message: 'The provider refused the request.' }], [12, { type: 'response.failed', response: { status: 'failed' } }]]);
  const s = text(html(<AgentTurnView turn={failed} />));
  assert.match(s, /Failed/);
  assert.match(s, /The provider refused the request\./);
});

test('the composer: Stop while running, Send otherwise, attachments removable', () => {
  const run = html(<AgentComposer value="" onChange={() => {}} onSend={() => {}} onStop={() => {}} running />);
  assert.match(run, /aria-label="Stop"/);
  assert.doesNotMatch(run, /aria-label="Send"/);
  const idle = html(<AgentComposer value="hi" onChange={() => {}} onSend={() => {}} attachments={[{ name: 'a.pdf' }]} onRemoveAttachment={() => {}} onAttachFiles={() => {}} />);
  assert.match(idle, /aria-label="Send"/);
  assert.match(idle, /aria-label="Remove a\.pdf"/);
  assert.match(idle, /aria-label="Attach a file"/);
  const empty = html(<AgentComposer value="  " onChange={() => {}} onSend={() => {}} />);
  assert.match(empty, /<button[^>]*disabled=""[^>]*aria-label="Send"|aria-label="Send"[^>]*disabled=""/);
});

test('the conversation docks its composer', () => {
  const h = html(<AgentConversation mode="page" composer={<div id="cmp" />}><p>turns</p></AgentConversation>);
  assert.match(h, /class="uac-convo is-page"/);
  assert.match(h, /<div class="uac-dock"><div id="cmp"><\/div><\/div>/);
});

test('the working line without a clock shows no time', () => {
  const h = html(<WorkingIndicator label="Thinking" />);
  assert.doesNotMatch(h, /uac-elapsed/);
  const timed = html(<WorkingIndicator label="Thinking" start={Date.now() - 2500} />);
  assert.match(text(timed), /2s · Thinking/);
});

test('the root entry is unchanged: its exports are all still there', () => {
  for (const k of ['ChatMessages', 'ChatPanel', 'Composer', 'ToolGroup', 'ToolRow', 'pumpResponsesStream', 'turnsToMessages', 'withText', 'SheetGrid', 'DialogHost']) {
    assert.ok(root[k], k);
  }
  assert.equal(root.AgentTurnView, undefined, 'agent-chat stays out of the root bundle');
});

test('ChatPanel view="agent" keeps its contract and draws turns with the agent view', async () => {
  const { ChatPanel } = root;
  const h = html(<ChatPanel sessionId="s1" view="agent" runTurn={async () => ({ ok: true })} loadHistory={async () => []} />);
  assert.match(h, /uic-chat/);
  const plain = html(<ChatPanel sessionId="s1" runTurn={async () => ({ ok: true })} loadHistory={async () => []} />);
  assert.match(plain, /uic-chat/);
});

test('tokens count the cache too, so harnesses read alike', () => {
  const t = build([[1000, { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 200, output_tokens: 70, total_tokens: 270, cache_read_tokens: 18000, cache_write_tokens: 1200 } } }]]);
  assert.match(text(html(<AgentTurnView turn={t} />)), /19\.5k tokens/);
  const only = build([[1000, { type: 'response.completed', response: { status: 'completed', usage: { total_tokens: 950 } } }]]);
  assert.match(text(html(<AgentTurnView turn={only} />)), /950 tokens/);
});

test('a produced file opens beside the conversation: one header row, the name switches files', async () => {
  const { ArtifactPanel, FileCard, middleEllipsis } = await import('../src/agent-chat/index.js');
  const files = [{ key: 'a', name: 'README.md', url: '/f/a' }, { key: 'b', name: 'cats.json', url: '/f/b', size: 2048, turn: 2 }];
  const h = html(<ArtifactPanel files={files} active="b" onSelect={() => {}} onClose={() => {}} />);
  assert.doesNotMatch(h, /uac-art-files/, 'no row of tabs');
  assert.match(h, /class="uic-fp-head"[\s\S]*uac-fs-btn[\s\S]*aria-label="Close preview"/, 'the switcher sits in the header row');
  assert.match(h, /aria-haspopup="listbox"/);
  assert.match(h, /class="uac-mid uac-fs-name"><span class="uac-mid-h">cats.json<\/span><\/span>/);
  const long = html(<ArtifactPanel files={[{ key: 'x', name: 'epsilla-enterprise-subscription-license-store-v2.png', url: '/x' }, files[0]]} active="x" />);
  assert.match(long, /<span class="uac-mid-t">e-store-v2.png<\/span>/, 'the end of a long name always shows');
  const one = html(<ArtifactPanel files={[files[0]]} overlay onClose={() => {}} />);
  assert.doesNotMatch(one, /aria-haspopup/, 'one file: nothing to switch to');
  assert.match(one, /uac-art is-overlay/);
  assert.match(one, /uac-art-scrim/);
  const card = html(<FileCard name="cats.json" onPreview={() => {}} onDownload={() => {}} onCopy={() => {}} active />);
  assert.match(card, /aria-label="Copy cats.json"/);
  assert.match(card, /is-active/);
  assert.equal(middleEllipsis('epsilla-enterprise-subscription-license-store-v2.png', 32), 'epsilla-enterpris…e-store-v2.png');
  assert.equal(middleEllipsis('short.png', 32), 'short.png');
});

test('an image file card shows the image', async () => {
  const { FileCard } = await import('../src/agent-chat/index.js');
  const h = html(<FileCard name="hero.png" thumb="blob:x" onPreview={() => {}} />);
  assert.match(h, /uic-filecard-thumb/);
  assert.match(h, /src="blob:x"/);
});
