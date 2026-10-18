// Tool calls in every harness's own words, as a person reads them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTool, toolKind, toolLine, summarizeCalls, resultNote, patchStats, formatElapsed, formatDuration, formatTokens, motionFor } from '../src/agent-chat/index.js';

const j = (o) => JSON.stringify(o);

test('shell commands across harnesses', () => {
  for (const name of ['Bash', 'exec_command', 'run_shell_command', 'terminal', 'developer__shell', 'execute_bash', 'shell', 'Shell']) {
    assert.equal(toolKind(name), 'shell', name);
  }
  const cc = describeTool('Bash', j({ command: 'npm test', description: 'Run the test suite' }));
  assert.equal(cc.target, 'Run the test suite', 'the agent\'s own description reads first');
  assert.equal(toolLine(cc, 'running'), 'Run the test suite');
  const codex = describeTool('exec_command', j({ command: ['bash', '-lc', 'ls -la'] }));
  assert.equal(codex.target, 'ls -la');
  assert.equal(codex.mono, true);
  assert.equal(toolLine(codex, 'running'), 'Running ls -la');
  assert.equal(toolLine(codex, 'done'), 'Ran ls -la');
});

test('files: read, write, edit, patch', () => {
  const r = describeTool('Read', j({ file_path: '/workspace/src/app.ts' }));
  assert.equal(r.kind, 'read');
  assert.equal(r.target, 'app.ts');
  assert.equal(r.targetFull, '/workspace/src/app.ts');
  assert.equal(toolLine(r, 'done'), 'Read app.ts');
  const w = describeTool('write_file', j({ path: 'notes.md', content: 'a\nb\nc\n' }));
  assert.equal(w.kind, 'write');
  assert.deepEqual(w.diff, { added: 3, removed: 0 });
  assert.equal(toolLine(w, 'done'), 'Created notes.md');
  const e = describeTool('Edit', j({ file_path: 'x.py', old_string: 'a\nb', new_string: 'a\nb\nc' }));
  assert.deepEqual(e.diff, { added: 3, removed: 2 });
  const m = describeTool('MultiEdit', j({ file_path: 'x.py', edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'd', new_string: '' }] }));
  assert.deepEqual(m.diff, { added: 2, removed: 2 });
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n+more\n*** End Patch';
  const p = describeTool('apply_patch', j({ input: patch }));
  assert.equal(p.kind, 'edit');
  assert.equal(p.target, 'a.ts');
  assert.deepEqual(p.diff, { added: 2, removed: 1 });
  assert.deepEqual(patchStats('--- a\n+++ b\n@@\n-x\n+y'), { added: 1, removed: 1 });
  const ed = describeTool('str_replace_editor', j({ command: 'view', path: '/w/a.txt' }));
  assert.equal(ed.kind, 'read');
  const cr = describeTool('developer__text_editor', j({ command: 'write', path: 'b.txt', file_text: 'x\ny' }));
  assert.equal(cr.kind, 'write');
  assert.deepEqual(cr.diff, { added: 2, removed: 0 });
  const gem = describeTool('replace', j({ file_path: 'c.go', old_string: 'x', new_string: 'y' }));
  assert.deepEqual(gem.diff, { added: 1, removed: 1 });
});

test('web, search, agents, plans, connected tools', () => {
  assert.equal(toolLine(describeTool('WebSearch', j({ query: 'sf events' })), 'running'), 'Searching the web for sf events');
  assert.equal(toolLine(describeTool('google_web_search', j({ query: 'q' })), 'done'), 'Searched the web for q');
  assert.equal(describeTool('WebFetch', j({ url: 'https://api.weather.gov/points/1,2' })).target, 'api.weather.gov/points/1,2');
  assert.equal(describeTool('Grep', j({ pattern: 'TODO', path: 'src' })).target, 'TODO');
  const ag = describeTool('Task', j({ description: 'Find events', subagent_type: 'general-purpose', prompt: '...' }));
  assert.equal(ag.kind, 'agent');
  assert.equal(ag.target, 'Find events');
  assert.equal(ag.note, 'general-purpose');
  const plan = describeTool('write_todos', j({ todos: [{ description: 'a', status: 'completed' }, { description: 'b', status: 'in_progress' }] }));
  assert.equal(plan.kind, 'todo');
  assert.deepEqual(plan.todos, [{ text: 'a', status: 'completed' }, { text: 'b', status: 'in_progress' }]);
  assert.equal(toolLine(plan, 'done'), 'Updated the plan');
  assert.equal(toolKind('mcp__github__create_issue'), 'mcp');
  assert.equal(toolKind('deepwiki.read_wiki_structure'), 'mcp');
  assert.equal(toolLine(describeTool('mcp__github__create_issue', '{}'), 'done'), 'Used Github · create issue');
  assert.equal(toolKind('browser_navigate'), 'browser');
  assert.equal(toolKind('frobnicate'), 'tool');
  assert.equal(toolLine(describeTool('frobnicate', 'not json'), 'running'), 'Using Frobnicate');
});

test('a run of calls summarized in the past tense', () => {
  assert.equal(summarizeCalls([{ name: 'Read', args: j({ file_path: 'a/b.ts' }) }]), 'Read b.ts');
  assert.equal(summarizeCalls([
    { name: 'Bash', args: '{}' }, { name: 'Bash', args: '{}' }, { name: 'Edit', args: '{}' }, { name: 'mcp__x__y', args: '{}' }, { name: 'zzz', args: '{}' },
  ]), 'Ran 2 commands, edited a file, used 2 tools');
  assert.equal(resultNote('read', 'a\nb\nc\n'), '3 lines');
  assert.equal(resultNote('glob', 'a\nb'), '2 files');
  assert.equal(resultNote('shell', 'x'), '');
});

test('clocks and counts', () => {
  assert.equal(formatElapsed(0), '0s');
  assert.equal(formatElapsed(2400), '2s');
  assert.equal(formatElapsed(64000), '1m 4s');
  assert.equal(formatElapsed(3723000), '1h 2m');
  assert.equal(formatElapsed(null), '');
  assert.equal(formatDuration(1234), '1.2s');
  assert.equal(formatDuration(31000), '31s');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(12345), '12.3k');
  assert.equal(formatTokens(61500), '61.5k');
  assert.equal(formatTokens(2000000), '2M');
});

test('every known base has a motion; an unknown one pulses', () => {
  assert.equal(motionFor('claude-code'), 'bloom');
  assert.equal(motionFor('codex'), 'sheen');
  assert.equal(motionFor('hermes'), 'flutter');
  assert.equal(motionFor('opencode'), 'blink');
  assert.equal(motionFor('goose'), 'glide');
  assert.equal(motionFor('gemini'), 'glint');
  assert.equal(motionFor('pi'), 'flip');
  assert.equal(motionFor('something-new'), 'pulse');
});
