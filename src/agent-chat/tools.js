// What a tool call IS, in a person's words, for every harness's vocabulary.
//
// Harnesses name the same act differently: Claude Code's `Bash`, Codex's `exec_command`, Gemini
// CLI's `run_shell_command`, Hermes's `terminal`, Goose's `developer__shell`, OpenHands's
// `execute_bash`. They pass through a gateway untouched, so the renderer is the one place that can
// read them all. describeTool(name, args) folds a call into one of a few kinds and pulls out the
// one thing a reader wants to see (the command, the file, the query, the URL), plus what the call
// changed (lines added and removed) and, for planning tools, the plan itself.
//
// Pure functions, no React: the reducer and the tests use them too.

/** Parse tool arguments that may be a JSON string, an object, or garbage. Never throws. */
export function parseToolArgs(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args !== 'string' || !args.trim()) return {};
  try {
    const v = JSON.parse(args);
    return v && typeof v === 'object' ? v : { value: v };
  } catch {
    return { _raw: args };
  }
}

const KIND_BY_NAME = {};
function kinds(kind, names) { for (const n of names) KIND_BY_NAME[n] = kind; }
kinds('shell', ['bash', 'shell', 'exec_command', 'local_shell', 'run_shell_command', 'terminal', 'execute_bash',
  'run_command', 'command', 'run_terminal_cmd', 'execute_command', 'powershell', 'cmd', 'command_execution',
  'exec', 'run', 'sh', 'process']);
kinds('shell_output', ['bashoutput', 'bash_output', 'killshell', 'kill_shell', 'killbash']);
kinds('read', ['read', 'read_file', 'readfile', 'view', 'view_file', 'cat', 'read_many_files', 'notebookread',
  'file_read', 'open_file', 'readmanyfiles', 'read_text_file']);
kinds('write', ['write', 'write_file', 'writefile', 'create_file', 'file_write', 'create', 'write_to_file']);
kinds('edit', ['edit', 'multiedit', 'multi_edit', 'str_replace', 'str_replace_editor', 'str_replace_based_edit_tool',
  'replace', 'apply_patch', 'patch', 'edit_file', 'strreplacefile', 'notebookedit', 'text_editor', 'file_change',
  'search_replace', 'insert', 'replace_in_file', 'editor']);
kinds('search', ['grep', 'search_file_content', 'search_files', 'rg', 'ripgrep', 'codebase_search', 'search',
  'grep_search', 'file_grep']);
kinds('glob', ['glob', 'find_files', 'file_search', 'find', 'glob_files']);
kinds('list', ['ls', 'list', 'list_directory', 'list_dir', 'listdir', 'list_files', 'tree']);
kinds('web_search', ['websearch', 'web_search', 'google_web_search', 'searchweb', 'search_web', 'tavily_search',
  'brave_search', 'web_search_preview', 'internet_search']);
kinds('web_fetch', ['webfetch', 'web_fetch', 'fetch', 'fetchurl', 'fetch_url', 'web_extract', 'read_url', 'browse',
  'url_fetch', 'http_get', 'curl']);
kinds('agent', ['task', 'agent', 'delegate_task', 'spawn_agent', 'subagent', 'dispatch_agent', 'run_agent',
  'launch_agent', 'call_agent']);
kinds('todo', ['todowrite', 'todo_write', 'todo', 'todos', 'update_plan', 'write_todos', 'settodolist',
  'set_todo_list', 'task_tracker', 'todoread', 'todo_read', 'plan', 'update_todos', 'manage_todo_list']);
kinds('skill', ['skill', 'use_skill', 'load_skill']);
kinds('think', ['think', 'sequentialthinking', 'sequential_thinking', 'reflect']);
kinds('toolsearch', ['toolsearch', 'tool_search', 'load_tools']);
kinds('browser', ['browser', 'computer', 'playwright', 'browser_use', 'navigate', 'screenshot']);

// Namespaces that prefix a tool name without changing what it does.
const NS = /^(developer|platform|computercontroller|builtin|default|functions|tools?)(__|\.|:)/;

/** The kind of a tool name, or 'mcp' for a connected tool, or 'tool' when it is unknown. */
export function toolKind(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'tool';
  if (/^mcp__/i.test(raw)) return 'mcp';
  const n = raw.toLowerCase().replace(NS, '');
  if (KIND_BY_NAME[n]) return KIND_BY_NAME[n];
  if (/^browser[_\-.]|[_\-.]browser$|^playwright|^computer[_\-.]/.test(n)) return 'browser';
  const flat = n.replace(/[^a-z0-9]/g, '');
  if (KIND_BY_NAME[flat]) return KIND_BY_NAME[flat];
  // `server.tool` (Codex) and `server__tool` (Goose, others) are connected tools
  if (/[a-z0-9](\.|__)[a-z0-9]/.test(n)) return 'mcp';
  return 'tool';
}

function str(v) { return v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : String(v); }
function firstOf(a, keys) {
  for (const k of keys) {
    const v = a[k];
    if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) return v;
  }
  return undefined;
}

export function baseNameOf(p) {
  const s = str(p).replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/** A shell command as one readable line: argv arrays joined, `bash -lc '…'` unwrapped. */
export function commandText(a) {
  let c = firstOf(a, ['command', 'cmd', 'commands', 'script', 'code', 'input', 'args']);
  if (Array.isArray(c)) {
    // ["bash", "-lc", "npm test"] -> npm test
    if (c.length >= 3 && /(^|\/)(ba|z)?sh$/.test(String(c[0])) && /^-\w*c$/.test(String(c[1]))) c = c.slice(2).join(' ');
    else c = c.join(' ');
  }
  return str(c).trim();
}

export function lineCount(s) {
  const t = str(s);
  if (!t) return 0;
  const n = t.split('\n').length;
  return t.endsWith('\n') ? n - 1 : n;
}

/** Lines added and removed by a unified diff / apply_patch body. */
export function patchStats(patch) {
  let added = 0; let removed = 0;
  for (const ln of str(patch).split('\n')) {
    if (/^(\+\+\+|---|\*\*\*|@@)/.test(ln)) continue;
    if (ln.startsWith('+')) added++;
    else if (ln.startsWith('-')) removed++;
  }
  return { added, removed };
}

function patchFiles(patch) {
  const out = [];
  for (const ln of str(patch).split('\n')) {
    const m = ln.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/) || ln.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (m && m[1] !== '/dev/null' && !out.includes(m[1].trim())) out.push(m[1].trim());
  }
  return out;
}

/** What a write/edit call changed: {added, removed}, or null when the call does not say. */
export function diffOf(kind, a) {
  if (kind === 'write') {
    const body = firstOf(a, ['content', 'file_text', 'text', 'contents', 'data']);
    return body == null ? null : { added: lineCount(body), removed: 0 };
  }
  if (kind !== 'edit') return null;
  const cmd = str(a.command).toLowerCase();
  if (cmd === 'view' || cmd === 'undo_edit') return null;
  if (cmd === 'create' || cmd === 'write') {
    const body = firstOf(a, ['file_text', 'content', 'text']);
    return body == null ? null : { added: lineCount(body), removed: 0 };
  }
  if (Array.isArray(a.edits)) {
    let added = 0; let removed = 0;
    for (const e of a.edits) {
      added += lineCount(firstOf(e || {}, ['new_string', 'new_str', 'newText', 'replacement']) || '');
      removed += lineCount(firstOf(e || {}, ['old_string', 'old_str', 'oldText', 'search']) || '');
    }
    return { added, removed };
  }
  const neu = firstOf(a, ['new_string', 'new_str', 'newText', 'new_text', 'replacement', 'replace']);
  const old = firstOf(a, ['old_string', 'old_str', 'oldText', 'old_text', 'search']);
  if (neu != null || old != null) return { added: lineCount(neu || ''), removed: lineCount(old || '') };
  const patch = firstOf(a, ['patch', 'diff', 'input', '_raw']);
  if (typeof patch === 'string' && /^(\*\*\* Begin Patch|---|\+\+\+|@@|diff )/m.test(patch)) return patchStats(patch);
  if (Array.isArray(a.changes)) {
    let added = 0; let removed = 0; let any = false;
    for (const c of a.changes) {
      const d = c && (c.diff || c.unified_diff || c.patch);
      if (typeof d === 'string') { const s = patchStats(d); added += s.added; removed += s.removed; any = true; }
    }
    return any ? { added, removed } : null;
  }
  return null;
}

const TODO_STATUS = { completed: 'completed', complete: 'completed', done: 'completed', finished: 'completed',
  in_progress: 'in_progress', inprogress: 'in_progress', active: 'in_progress', doing: 'in_progress', running: 'in_progress',
  pending: 'pending', todo: 'pending', not_started: 'pending', open: 'pending', cancelled: 'cancelled', canceled: 'cancelled' };

/** The plan a todo/plan tool call states, as [{text, status}], or null when it states none. */
export function todosOf(a) {
  const list = firstOf(a, ['todos', 'plan', 'items', 'tasks', 'todo_list', 'steps', 'task_list']);
  if (!Array.isArray(list) || !list.length) return null;
  const out = [];
  for (const t of list) {
    if (typeof t === 'string') { out.push({ text: t, status: 'pending' }); continue; }
    if (!t || typeof t !== 'object') continue;
    const text = str(firstOf(t, ['content', 'step', 'title', 'text', 'description', 'task', 'name'])).trim();
    if (!text) continue;
    let st = str(firstOf(t, ['status', 'state'])).toLowerCase().replace(/[\s-]+/g, '_');
    if (!st && typeof t.done === 'boolean') st = t.done ? 'completed' : 'pending';
    if (!st && typeof t.completed === 'boolean') st = t.completed ? 'completed' : 'pending';
    out.push({ text, status: TODO_STATUS[st] || 'pending' });
  }
  return out.length ? out : null;
}

function shortUrl(u) {
  const s = str(u);
  try {
    const x = new URL(s);
    return (x.host + (x.pathname === '/' ? '' : x.pathname)).replace(/\/$/, '');
  } catch { return s; }
}

function humanizeName(n) {
  return str(n).replace(/^mcp__/i, '').replace(/__|\./g, ' · ').replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2').trim().replace(/^\w/, (c) => c.toUpperCase());
}

// [running, done] verbs per kind. The target follows the verb.
const VERBS = {
  shell: ['Running', 'Ran'], shell_output: ['Reading output of', 'Read output of'],
  read: ['Reading', 'Read'], write: ['Writing', 'Created'], edit: ['Editing', 'Edited'],
  search: ['Searching for', 'Searched for'], glob: ['Finding', 'Found'], list: ['Listing', 'Listed'],
  web_search: ['Searching the web for', 'Searched the web for'], web_fetch: ['Fetching', 'Fetched'],
  agent: ['Running agent', 'Ran agent'], todo: ['Updating the plan', 'Updated the plan'],
  skill: ['Using skill', 'Used skill'], think: ['Thinking', 'Thought'], toolsearch: ['Loading tools', 'Loaded tools'],
  browser: ['Using the browser', 'Used the browser'], mcp: ['Using', 'Used'], tool: ['Using', 'Used'],
};

/**
 * describeTool(name, args) -> {
 *   kind,            one of the kinds above
 *   target,          the short thing the call acts on ('' when it has none)
 *   targetFull,      the long form for a tooltip (full path, full command)
 *   mono,            true when the target is code (a command, a path, a pattern)
 *   running, done,   the verb phrases ("Running", "Ran") the row and the live line use
 *   diff,            {added, removed} | null
 *   todos,           [{text, status}] | null
 *   note,            a secondary label (an agent's type, a skill)
 * }
 */
export function describeTool(name, args) {
  const a = parseToolArgs(args);
  let kind = toolKind(name);
  const nm = str(name);
  // One editor tool, several acts (Anthropic's str_replace_editor, Goose's text_editor).
  if (kind === 'edit' && /^(view|read)$/i.test(str(a.command))) kind = 'read';
  if (kind === 'edit' && /^(create|write)$/i.test(str(a.command))) kind = 'write';
  let target = ''; let targetFull = ''; let mono = false; let note = '';
  const pathOf = () => firstOf(a, ['file_path', 'path', 'filePath', 'absolute_path', 'target_file', 'filename',
    'file', 'notebook_path', 'paths', 'absolute_paths', 'dir_path', 'directory']);
  switch (kind) {
    case 'shell': {
      const desc = str(firstOf(a, ['description', 'summary', 'title'])).trim();
      const cmd = commandText(a);
      targetFull = cmd || desc;
      if (desc) { target = desc; note = cmd; } else { target = cmd; mono = !!cmd; }
      break;
    }
    case 'shell_output': target = str(firstOf(a, ['bash_id', 'shell_id', 'id'])); mono = true; break;
    case 'read': case 'write': case 'edit': case 'list': {
      let p = pathOf();
      if (Array.isArray(p)) p = p.length > 1 ? `${baseNameOf(p[0])} and ${p.length - 1} more` : p[0];
      if (!p && kind === 'edit') {
        const files = patchFiles(firstOf(a, ['patch', 'input', '_raw']) || '')
          .concat(Array.isArray(a.changes) ? a.changes.map((c) => c && c.path).filter(Boolean) : []);
        if (files.length) p = files.length > 1 ? `${baseNameOf(files[0])} and ${files.length - 1} more` : files[0];
      }
      targetFull = str(p);
      target = kind === 'list' ? (str(p) || '.') : baseNameOf(p);
      mono = !!target;
      break;
    }
    case 'search': case 'glob': {
      const pat = firstOf(a, ['pattern', 'query', 'regex', 'q', 'glob', 'search', 'text']);
      const where = firstOf(a, ['path', 'dir_path', 'directory', 'include']);
      target = str(pat); mono = true;
      targetFull = where ? `${str(pat)} in ${str(where)}` : str(pat);
      break;
    }
    case 'web_search': target = str(firstOf(a, ['query', 'q', 'search_query', 'queries', 'search'])); targetFull = target; break;
    case 'web_fetch': {
      const u = firstOf(a, ['url', 'urls', 'uri', 'href', 'link']);
      targetFull = Array.isArray(u) ? u.join(' ') : str(u);
      target = Array.isArray(u) ? `${shortUrl(u[0])}${u.length > 1 ? ` and ${u.length - 1} more` : ''}` : shortUrl(u);
      break;
    }
    case 'agent':
      target = str(firstOf(a, ['description', 'task', 'title', 'name', 'goal'])) || str(firstOf(a, ['prompt'])).slice(0, 80);
      note = str(firstOf(a, ['subagent_type', 'agent', 'agent_type', 'role']));
      targetFull = str(firstOf(a, ['prompt', 'task', 'description']));
      break;
    case 'skill': target = str(firstOf(a, ['skill', 'name', 'command', 'skill_name'])); mono = true; targetFull = target; break;
    case 'browser': {
      const act = str(firstOf(a, ['action', 'command', 'type']));
      const u = str(firstOf(a, ['url', 'selector', 'text']));
      target = [act, u ? shortUrl(u) : ''].filter(Boolean).join(' ');
      targetFull = target;
      if (/^browser[_\-.]/i.test(nm)) note = humanizeName(nm.replace(/^browser[_\-.]/i, ''));
      break;
    }
    case 'mcp': case 'tool': {
      target = humanizeName(nm);
      targetFull = nm;
      break;
    }
    default: break;
  }
  const v = VERBS[kind] || VERBS.tool;
  return {
    kind, target: target.replace(/\s+/g, ' ').trim(), targetFull, mono, note,
    running: v[0], done: v[1],
    diff: diffOf(kind, a),
    todos: kind === 'todo' ? todosOf(a) : null,
  };
}

/** "Ran npm test", "Read app.ts", "Created analyze.py": verb + target, one line. */
export function toolLine(d, state) {
  const verb = state === 'running' ? d.running : d.done;
  if (d.kind === 'todo' || d.kind === 'toolsearch' || d.kind === 'think') return verb;
  if (d.kind === 'shell' && d.target && !d.mono) return d.target;          // the agent's own description
  if (d.kind === 'mcp' || d.kind === 'tool') return `${verb} ${d.target || 'a tool'}`;
  return d.target ? `${verb} ${d.target}` : `${verb} ${KIND_NOUN[d.kind] || 'a tool'}`;
}
const KIND_NOUN = { shell: 'a command', read: 'a file', write: 'a file', edit: 'a file', search: 'code', glob: 'files',
  list: 'a folder', web_search: '', web_fetch: 'a page', agent: '', skill: 'a skill', browser: '', shell_output: 'a command' };

// Group recap: one phrase per kind, counted, in first-seen order.
const PHRASES = {
  shell: (n) => (n === 1 ? 'ran a command' : `ran ${n} commands`),
  shell_output: (n) => (n === 1 ? 'checked a command' : `checked ${n} commands`),
  read: (n) => (n === 1 ? 'read a file' : `read ${n} files`),
  write: (n) => (n === 1 ? 'created a file' : `created ${n} files`),
  edit: (n) => (n === 1 ? 'edited a file' : `edited ${n} files`),
  search: (n) => (n === 1 ? 'searched code' : `searched code ${n} times`),
  glob: () => 'found files',
  list: (n) => (n === 1 ? 'listed a folder' : `listed ${n} folders`),
  web_search: (n) => (n === 1 ? 'searched the web' : `searched the web ${n} times`),
  web_fetch: (n) => (n === 1 ? 'fetched a page' : `fetched ${n} pages`),
  agent: (n) => (n === 1 ? 'ran an agent' : `ran ${n} agents`),
  todo: () => 'updated the plan',
  skill: (n) => (n === 1 ? 'used a skill' : `used ${n} skills`),
  think: () => 'thought it through',
  toolsearch: () => 'loaded tools',
  browser: () => 'used the browser',
  mcp: (n) => (n === 1 ? 'used a tool' : `used ${n} tools`),
  tool: (n) => (n === 1 ? 'used a tool' : `used ${n} tools`),
};

/**
 * One past-tense line for a run of finished calls: "Ran 3 commands, edited app.ts".
 * A single call reads as itself ("Read app.ts"). `calls` are [{name, args}].
 */
export function summarizeCalls(calls) {
  const list = (calls || []).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return toolLine(describeTool(list[0].name, list[0].args), 'done');
  const order = []; const count = {};
  for (const c of list) {
    let k = toolKind(c.name);
    if (k === 'mcp') k = 'tool';
    if (!(k in count)) { count[k] = 0; order.push(k); }
    count[k]++;
  }
  // mcp and unknown tools share one phrase ("used 3 tools"), placed where the first appeared
  const s = order.map((k) => (PHRASES[k] || PHRASES.tool)(count[k])).join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A short result summary for a finished call ("120 lines", "3 files"), or ''. */
export function resultNote(kind, output) {
  const out = str(output);
  if (!out.trim()) return '';
  const n = lineCount(out.trim());
  if (kind === 'read') return n === 1 ? '1 line' : `${n} lines`;
  if (kind === 'glob') return n === 1 ? '1 file' : `${n} files`;
  if (kind === 'search') return n === 1 ? '1 match' : `${n} matches`;
  return '';
}
