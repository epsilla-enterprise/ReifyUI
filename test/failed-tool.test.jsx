// A call the tool reported as failed (`is_error: true` on its result) reads as failed everywhere a
// call is shown, in words: the stream handlers, the blocks, history, ToolRow, the agent view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createResponsesDispatcher, withStep, withResult, turnsToMessages, ToolRow } from '../src/index.js';
import { turnFromMessage, reduceTurn, newTurn, describeTool, commandText } from '../src/agent-chat/index.js';

test('the dispatcher hands isError to onToolResult, true only when the item says so', () => {
  const got = [];
  const d = createResponsesDispatcher({ onToolResult: (id, out, err) => got.push([id, out, err]) });
  d.dispatch({ type: 'response.output_item.added', item: { type: 'function_call_output', call_id: 'a', output: 'x', is_error: true } });
  d.dispatch({ type: 'response.output_item.added', item: { type: 'function_call_output', call_id: 'b', output: 'y' } });
  assert.deepEqual(got, [['a', 'x', true], ['b', 'y', false]]);
});

test('blocks, history and both views mark it', () => {
  let b = withStep([], { name: 'Bash', args: '{"command":"cat /nope"}', callId: 'a' });
  b = withResult(b, 'a', 'cat: /nope: No such file', true);
  assert.equal(b[0].steps[0].isError, true);
  const ok = withResult(withStep([], { name: 'Bash', args: '{}', callId: 'c' }), 'c', 'fine', false);
  assert.equal('isError' in ok[0].steps[0], false, 'absent, never false');
  const hist = turnsToMessages([{ user: 'u', status: 'completed', assistant: 'x', tools: [{ name: 'Bash', arguments: '{}', output: 'no', is_error: true }] }]);
  assert.equal(hist[1].blocks[0].steps[0].isError, true);
  assert.equal(hist[1].blocks[0].steps[0].result, 'no', 'the record names the result `output`');
  const t = turnFromMessage({ status: 'done', blocks: b });
  assert.equal(t.items[0].status, 'failed');
  const live = reduceTurn(reduceTurn(newTurn(), { type: 'response.output_item.added', item: { type: 'function_call', call_id: 'a', name: 'Bash', arguments: '{}' } }, 1),
    { type: 'response.output_item.added', item: { type: 'function_call_output', call_id: 'a', output: 'no', is_error: true } }, 2);
  assert.equal(live.items[0].status, 'failed');
  const h = renderToStaticMarkup(<ToolRow step={b[0].steps[0]} />);
  assert.match(h, /is-failed/);
  assert.match(h, />Failed</);
});

test('a command Codex wrapped in a login shell reads as the command', () => {
  assert.equal(commandText({ command: "/bin/bash -lc 'cat /no/such/file_xyz'" }), 'cat /no/such/file_xyz');
  assert.equal(commandText({ command: "bash -lc 'echo '\\''hi'\\'''" }), "echo 'hi'");
  assert.equal(commandText({ command: 'ls -la' }), 'ls -la');
  assert.equal(describeTool('Bash', JSON.stringify({ command: "/bin/bash -lc 'pwd'" })).target, 'pwd');
});
