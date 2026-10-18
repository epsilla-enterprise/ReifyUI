// The turn reducer, fed the event sequences the HarnessRouter gateway actually emits
// (backend/harness_gateway/app.py _RespTranslator: start / _handle / complete / fail).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newTurn, reduceTurn, turnFromEvents, turnFromHistory, turnFromMessage, turnFromResponse, liveState, segments, latestPlan,
  describeTool,
} from '../src/agent-chat/index.js';

const created = (id = 'resp_1', sid = 'sess_1') => ({ type: 'response.created', response: { id, status: 'in_progress', metadata: { session_id: sid }, model: 'm1' } });
const reasoning = (oi, id, text) => [
  { type: 'response.output_item.added', output_index: oi, item: { id, type: 'reasoning', summary: [], status: 'in_progress' } },
  { type: 'response.reasoning_summary_part.added', item_id: id, output_index: oi, summary_index: 0 },
  { type: 'response.reasoning_summary_text.delta', item_id: id, output_index: oi, delta: text },
];
const reasoningDone = (oi, id, text) => ({ type: 'response.output_item.done', output_index: oi, item: { id, type: 'reasoning', summary: [{ type: 'summary_text', text }], status: 'completed' } });
const msg = (oi, id) => [
  { type: 'response.output_item.added', output_index: oi, item: { id, type: 'message', status: 'in_progress', role: 'assistant', content: [] } },
  { type: 'response.content_part.added', item_id: id, output_index: oi, content_index: 0 },
];
const delta = (oi, id, d) => ({ type: 'response.output_text.delta', item_id: id, output_index: oi, content_index: 0, delta: d });
const call = (oi, fid, callId, name, args) => [
  { type: 'response.output_item.added', output_index: oi, item: { id: fid, type: 'function_call', call_id: callId, name, arguments: '', status: 'in_progress' } },
  { type: 'response.function_call_arguments.delta', item_id: fid, output_index: oi, delta: args },
  { type: 'response.function_call_arguments.done', item_id: fid, output_index: oi, arguments: args },
  { type: 'response.output_item.done', output_index: oi, item: { id: fid, type: 'function_call', call_id: callId, name, arguments: args, status: 'completed' } },
];
const result = (oi, callId, output, extra = {}) => [
  { type: 'response.output_item.added', output_index: oi, item: { id: `fco_${oi}`, type: 'function_call_output', call_id: callId, output, status: 'completed', ...extra } },
  { type: 'response.output_item.done', output_index: oi, item: { id: `fco_${oi}`, type: 'function_call_output', call_id: callId, output, status: 'completed', ...extra } },
];
const completed = (usage) => ({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', usage, metadata: {} } });

/** Feed [at, events] pairs. */
function feed(t, steps) {
  for (const [at, evs] of steps) for (const ev of [].concat(evs)) t = reduceTurn(t, ev, at);
  return t;
}

test('a whole turn: thinking, prose, a call and its result, more prose, the end', () => {
  let t = newTurn({ user: { text: 'run the tests' }, startedAt: 1000 });
  assert.equal(liveState(t).phase, 'starting');
  t = feed(t, [
    [1200, created()],
    [1300, reasoning(0, 'rs_a', 'Let me look')],
    [2600, [reasoningDone(0, 'rs_a', 'Let me look'), ...msg(1, 'msg_a'), delta(1, 'msg_a', 'I will run '), delta(1, 'msg_a', 'the tests.')]],
    [3000, call(2, 'fc_a', 'call_1', 'Bash', '{"command":"npm test","description":"Run the test suite"}')],
  ]);
  assert.equal(t.id, 'resp_1');
  assert.equal(t.sessionId, 'sess_1');
  assert.equal(t.startedAt, 1000, 'the clock counts from the send, not from the first event');
  const th = t.items[0];
  assert.equal(th.kind, 'thinking');
  assert.equal(th.startedAt, 1300);
  assert.equal(th.endedAt, 2600);
  assert.equal(t.items[1].text, 'I will run the tests.');
  const tool = t.items[2];
  assert.equal(tool.kind, 'tool');
  assert.equal(tool.status, 'running');
  assert.equal(tool.args, '{"command":"npm test","description":"Run the test suite"}', 'arguments are not doubled by delta + done');
  assert.equal(tool.startedAt, 3000);
  const live = liveState(t);
  assert.equal(live.phase, 'tool');
  assert.equal(live.tool.id, 'call_1');
  t = feed(t, [
    [7400, result(3, 'call_1', '12 passing')],
    [7500, [...msg(4, 'msg_b'), delta(4, 'msg_b', 'All 12 pass.')]],
    [8000, completed({ input_tokens: 9000, output_tokens: 3300, total_tokens: 12300 })],
  ]);
  const done = t.items[2];
  assert.equal(done.status, 'done');
  assert.equal(done.output, '12 passing');
  assert.equal(done.endedAt - done.startedAt, 4400);
  assert.equal(t.status, 'done');
  assert.equal(t.endedAt, 8000);
  assert.equal(t.usage.total_tokens, 12300);
  assert.equal(liveState(t), null);
  const segs = segments(t);
  assert.deepEqual(segs.map((s) => s.type), ['work', 'text', 'work', 'text']);
});

test('a replay (at = null) never invents a time', () => {
  const t = turnFromEvents([created(), ...call(0, 'fc', 'c1', 'Read', '{"file_path":"/a/b.ts"}'), ...result(1, 'c1', 'x\ny'), completed()]);
  assert.equal(t.items[0].startedAt, null);
  assert.equal(t.items[0].endedAt, null);
  assert.equal(t.startedAt, null);
  assert.equal(t.endedAt, null);
});

test('a call first sent without arguments is filled, not doubled (late fill)', () => {
  let t = newTurn();
  t = feed(t, [[1, created()], [2, { type: 'response.output_item.added', output_index: 0, item: { id: 'fc1', type: 'function_call', call_id: 'c9', name: 'Read', arguments: '' } }]]);
  t = reduceTurn(t, { type: 'response.function_call_arguments.done', item_id: 'fc1', output_index: 0, arguments: '{"path":"x.md"}' }, 3);
  t = reduceTurn(t, { type: 'response.output_item.done', output_index: 0, item: { id: 'fc1', type: 'function_call', call_id: 'c9', name: 'Read', arguments: '{"path":"x.md"}' } }, 3);
  assert.equal(t.items.filter((x) => x.kind === 'tool').length, 1);
  assert.equal(t.items[0].args, '{"path":"x.md"}');
});

test('a call with no result is closed when the model speaks again; a sub-agent is not', () => {
  let t = newTurn({ startedAt: 0 });
  t = feed(t, [
    [1, created()],
    [2, call(0, 'fc1', 'ws', 'WebSearch', '{"query":"sf events"}')],    // codex reports searches with no result
    [3, call(1, 'fc2', 'ag', 'Task', '{"description":"find events","subagent_type":"general"}')],
    [4, [...msg(2, 'm1'), delta(2, 'm1', 'searching')]],
  ]);
  const byId = Object.fromEntries(t.items.filter((x) => x.kind === 'tool').map((x) => [x.id, x]));
  assert.equal(byId.ws.status, 'done');
  assert.equal(byId.ws.endedAt, null, 'closed, but with no end anybody saw');
  assert.equal(byId.ag.status, 'running', 'a sub-agent keeps working while its messages stream');
});

test('a failed call: the result says is_error', () => {
  let t = newTurn({ startedAt: 0 });
  t = feed(t, [[1, created()], [2, call(0, 'f', 'c', 'Bash', '{"command":"ls /nope"}')], [3, result(1, 'c', 'ls: /nope: No such file or directory', { is_error: true })]]);
  assert.equal(t.items[0].status, 'failed');
});

test('the same result twice (stream and feed) is applied once', () => {
  let t = newTurn({ startedAt: 0 });
  t = feed(t, [[1, created()], [2, call(0, 'f', 'c', 'Bash', '{}')], [3, result(1, 'c', 'one')], [9, result(1, 'c', 'two')]]);
  assert.equal(t.items[0].output, 'one');
  assert.equal(t.items[0].endedAt, 3);
});

test('a failed turn: the error event, then response.failed; open calls are stopped', () => {
  let t = newTurn({ startedAt: 0 });
  t = feed(t, [[1, created()], [2, call(0, 'f', 'c', 'Bash', '{"command":"sleep 99"}')],
    [5, { type: 'error', code: 'turn_failed', message: 'The model provider refused the request.' }],
    [5, { type: 'response.failed', response: { id: 'resp_1', status: 'failed', error: { type: 'harness_error', code: 'turn_failed', message: 'The model provider refused the request.' } } }]]);
  assert.equal(t.status, 'failed');
  assert.equal(t.error, 'The model provider refused the request.');
  assert.equal(t.items[0].status, 'stopped');
});

test('a stop arrives as response.failed with status cancelled', () => {
  const t = feed(newTurn({ startedAt: 0 }), [[1, created()], [4, { type: 'response.failed', response: { status: 'cancelled' } }]]);
  assert.equal(t.status, 'cancelled');
  assert.equal(t.endedAt, 4);
});

test('an incomplete turn keeps why', () => {
  const t = feed(newTurn({ startedAt: 0 }), [[1, created()], [4, { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_steps' } } }]]);
  assert.equal(t.status, 'incomplete');
  assert.deepEqual(t.incomplete, { reason: 'max_steps', detail: '' });
});

test('produced files are a set', () => {
  const ann = { type: 'response.output_text.annotation.added', annotation: { type: 'container_file_citation', container_id: 'k', file_id: 'f1', filename: 'a.md' } };
  const t = feed(newTurn(), [[1, ann], [2, ann]]);
  assert.equal(t.files.length, 1);
});

test('live phases: thinking after a result, writing while prose streams', () => {
  let t = feed(newTurn({ startedAt: 0 }), [[1, created()]]);
  assert.equal(liveState(t).phase, 'thinking');
  t = feed(t, [[2, call(0, 'f', 'c', 'Read', '{"file_path":"a"}')], [3, result(1, 'c', 'x')]]);
  assert.equal(liveState(t).phase, 'thinking');
  t = feed(t, [[4, [...msg(2, 'm'), delta(2, 'm', 'Hi')]]]);
  assert.equal(liveState(t).phase, 'writing');
});

test('the plan is the latest planning call, whatever the harness calls it', () => {
  let t = newTurn();
  t = feed(t, [[1, call(0, 'a', 'c1', 'TodoWrite', JSON.stringify({ todos: [{ content: 'one', status: 'in_progress' }, { content: 'two', status: 'pending' }] }))],
    [2, call(1, 'b', 'c2', 'update_plan', JSON.stringify({ plan: [{ step: 'one', status: 'completed' }, { step: 'two', status: 'in_progress' }] }))]]);
  assert.deepEqual(latestPlan(t, describeTool), [{ text: 'one', status: 'completed' }, { text: 'two', status: 'in_progress' }]);
});

test('history: a turns-feed entry', () => {
  const t = turnFromHistory({ id: 'r1', status: 'completed', user: 'hi', user_files: [{ name: 'a.png' }], assistant: 'done',
    tools: [{ name: 'Bash', arguments: '{"command":"ls"}', call_id: 'c', output: 'a\nb' }], files: [], elapsed: 64.2 });
  assert.equal(t.status, 'done');
  assert.equal(t.user.text, 'hi');
  assert.equal(t.items[0].kind, 'tool');
  assert.equal(t.items[0].status, 'done');
  assert.equal(t.items[1].text, 'done');
  assert.equal(t.elapsedMs, 64200);
  const running = turnFromHistory({ status: 'running', tools: [{ name: 'Bash', arguments: '{}' }] });
  assert.equal(running.items[0].status, 'running');
});

test('a blocks-model message borrows its clock call by call', () => {
  let clock = newTurn({ startedAt: 100 });
  clock = feed(clock, [[110, created()], [120, call(0, 'f', 'c1', 'Bash', '{"command":"ls"}')], [2120, result(1, 'c1', 'a')]]);
  const m = { role: 'assistant', status: 'running', files: [], blocks: [
    { kind: 'tools', reasoning: '', steps: [{ name: 'Bash', args: '{"command":"ls"}', callId: 'c1', result: 'a' }, { name: 'Read', args: '{"path":"x"}', callId: 'c2' }] },
  ] };
  const t = turnFromMessage(m, clock);
  assert.equal(t.items[0].startedAt, 120);
  assert.equal(t.items[0].endedAt, 2120);
  assert.equal(t.items[1].status, 'running');
  assert.equal(t.startedAt, 100);
  const failed = turnFromMessage({ status: 'failed', blocks: [{ kind: 'text', text: 'partial' }, { kind: 'text', text: '\n\nError: boom', error: true }] });
  assert.equal(failed.error, 'boom');
  assert.equal(failed.items.length, 1);
});

test('a stored response replays in order', () => {
  const t = turnFromResponse({ id: 'r', status: 'completed', created_at: 10, usage: { total_tokens: 5 }, output: [
    { type: 'function_call', id: 'f', call_id: 'c', name: 'Read', arguments: '{"file_path":"a"}' },
    { type: 'function_call_output', call_id: 'c', output: 'x' },
    { type: 'message', id: 'm', content: [{ type: 'output_text', text: 'ok' }] },
  ] });
  assert.equal(t.status, 'done');
  assert.deepEqual(t.items.map((x) => x.kind), ['tool', 'text']);
  assert.equal(t.items[1].text, 'ok');
  assert.equal(t.usage.total_tokens, 5);
});

test('the reducer never mutates its input', () => {
  const t0 = feed(newTurn(), [[1, created()], [2, call(0, 'f', 'c', 'Bash', '{}')]]);
  const snap = JSON.stringify(t0);
  reduceTurn(t0, result(1, 'c', 'x')[0], 3);
  reduceTurn(t0, delta(2, 'm', 'hi'), 3);
  assert.equal(JSON.stringify(t0), snap);
});
