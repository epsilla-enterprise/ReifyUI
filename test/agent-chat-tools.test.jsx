// Tool calls in every harness's own words, as a person reads them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTool, toolKind, toolLine, summarizeCalls, resultNote, patchStats, formatElapsed, formatDuration, formatTokens, motionFor, browserElements, browserActOf } from '../src/agent-chat/index.js';

const j = (o) => JSON.stringify(o);

test('shell commands across harnesses', () => {
  for (const name of ['Bash', 'exec_command', 'run_shell_command', 'terminal', 'developer__shell', 'execute_bash', 'shell', 'Shell', 'execute']) {
    assert.equal(toolKind(name), 'shell', name);
  }
  // Deep Agents' shell tool: the row names the command, not "Using Execute"
  const dcode = describeTool('execute', j({ command: 'sleep 8; echo done', timeout: 10 }));
  assert.equal(toolLine(dcode, 'running'), 'Running sleep 8; echo done');
  assert.equal(toolLine(dcode, 'done'), 'Ran sleep 8; echo done');
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

test('a browser call names what it did, never "a tool"', () => {
  const line = (name, args, st = 'done', element) => toolLine(describeTool(name, j(args), { element }), st);
  // the browser plug's thirteen tools, as the agent calls them
  assert.equal(line('browser_navigate', { url: 'https://duckduckgo.com/' }), 'Opened duckduckgo.com');
  assert.equal(line('browser_navigate', { url: 'https://www.bing.com/images/search?q=x' }, 'running'), 'Opening www.bing.com/images/search');
  assert.equal(line('browser_click', { ref: 'e12' }), 'Clicked on the page');
  assert.equal(line('browser_click', { selector: 'a.result__a' }), 'Clicked a link');
  assert.equal(line('browser_click', { selector: 'button[type=submit]' }), 'Clicked a button');
  assert.equal(line('browser_type', { ref: 'e2', text: 'hunter2', submit: true }), 'Typed into a field');
  assert.equal(line('browser_type', { ref: 'e2', text: 'cats' }, 'running'), 'Typing into a field');
  assert.equal(line('browser_screenshot', {}), 'Took a screenshot');
  assert.equal(line('browser_screenshot', { full_page: true }), 'Took a screenshot of the whole page');
  assert.equal(line('browser_snapshot', {}), 'Read the page');
  assert.equal(line('browser_extract_text', {}), 'Read the page’s text');
  assert.equal(line('browser_get_url', {}), 'Checked the address');
  assert.equal(line('browser_press_key', { key: 'Enter' }), 'Pressed Enter');
  assert.equal(line('browser_scroll', { direction: 'down', pixels: 600 }), 'Scrolled down');
  assert.equal(line('browser_scroll', {}), 'Scrolled the page');
  assert.equal(line('browser_wait_for', { text: 'Results' }), 'Waited for “Results”');
  assert.equal(line('browser_wait_for', { ms: 2000 }), 'Waited 2s');
  assert.equal(line('browser_back', {}), 'Went back a page');
  assert.equal(line('browser_list_tabs', {}), 'Listed the tabs');
  assert.equal(line('browser_switch_tab', { index: 1 }), 'Switched tabs');
  // the element a ref names, when a snapshot said
  assert.equal(line('browser_click', { ref: 'e12' }, 'done', { role: 'link', name: 'About' }), 'Clicked the “About” link');
  assert.equal(line('browser_type', { ref: 'e2', text: 'x' }, 'done', { role: 'textbox', name: 'Search' }), 'Typed into the “Search” field');
  assert.equal(line('browser_click', { ref: 'e3' }, 'done', { role: 'button', name: '' }), 'Clicked a button');
  // what was typed is never in the line
  assert.doesNotMatch(line('browser_type', { ref: 'e2', text: 'hunter2' }), /hunter2/);
  // the same tools through a connected server, Playwright MCP's names, one tool with an action
  for (const name of ['mcp__plugs__browser_click', 'plugs.browser_click', 'plugs__browser_click', 'mcp__playwright__browser_click']) {
    assert.equal(toolKind(name), 'browser', name);
    assert.equal(line(name, { ref: 'e1' }), 'Clicked on the page', name);
  }
  assert.equal(line('mcp__playwright__browser_take_screenshot', {}), 'Took a screenshot');
  assert.equal(line('browser_navigate_back', {}), 'Went back a page');
  assert.equal(line('browser_click', { element: 'Sign in button', ref: 'e9' }), 'Clicked Sign in button');
  assert.equal(line('browser_wait_for', { time: 3 }), 'Waited 3s');
  assert.equal(line('computer', { action: 'left_click', coordinate: [10, 20] }), 'Clicked on the page');
  assert.equal(line('computer', { action: 'key', text: 'Return' }), 'Pressed Return');
  assert.equal(line('browser', { action: 'navigate', url: 'https://example.com/a' }), 'Opened example.com/a');
  assert.equal(line('browser', {}), 'Used the browser');
  assert.equal(line('browser_frobnicate', {}), 'Used the browser');
  // no browser line anywhere says "a tool"
  for (const name of ['browser_click', 'browser_hover', 'browser_select_option', 'browser_drag', 'browser_evaluate', 'browser_close', 'browser', 'browser_x']) {
    for (const st of ['running', 'done']) assert.doesNotMatch(line(name, {}, st), /a tool/, `${name} ${st}`);
  }
  // other kinds with nothing to name read whole too
  assert.equal(toolLine(describeTool('WebSearch', '{}'), 'done'), 'Searched the web');
});

test('the element a browser call acted on, from the snapshot before it', () => {
  const items = [
    { kind: 'tool', id: 'a', name: 'browser_navigate', args: j({ url: 'https://duckduckgo.com' }), output: 'Opened https://duckduckgo.com/ (DuckDuckGo)\n\ne1 link "About"\ne2 textbox "Search the web"', status: 'done' },
    { kind: 'tool', id: 'b', name: 'browser_type', args: j({ ref: 'e2', text: 'cats' }), output: 'Typed 4 characters.', status: 'done' },
    { kind: 'tool', id: 'c', name: 'browser_snapshot', args: '{}', output: 'https://duckduckgo.com/?q=cats\n\ne1 button "Images"', status: 'done' },
    { kind: 'tool', id: 'd', name: 'browser_click', args: j({ ref: 'e1' }), output: 'Clicked.', status: 'done' },
    { kind: 'tool', id: 'e', name: 'mcp__playwright__browser_snapshot', args: '{}', output: '- generic [ref=e1]:\n  - link "Docs" [ref=e7] [cursor=pointer]', status: 'done' },
    { kind: 'tool', id: 'f', name: 'mcp__playwright__browser_click', args: j({ ref: 'e7' }), status: 'running' },
  ];
  const el = browserElements(items);
  assert.deepEqual(el.b, { role: 'textbox', name: 'Search the web' });
  assert.deepEqual(el.d, { role: 'button', name: 'Images' }, 'refs are read against the latest snapshot');
  assert.deepEqual(el.f, { role: 'link', name: 'Docs' });
  assert.equal(summarizeCalls([{ name: items[3].name, args: items[3].args, element: el.d }]), 'Clicked the “Images” button');
  assert.equal(browserActOf('mcp__plugs__browser_navigate'), 'navigate');
  assert.equal(browserActOf('computer'), '');
  assert.equal(browserActOf('Bash'), null);
});
