// Tool-step presentation metadata — extracted from HarnessRouter's workbench.
// toolMeta(name, args) -> { Icon, label, chip? }: a rich end-user-facing row for one tool step.
// summarizeSteps(steps) -> "Ran 5 commands, read 2 files, wrote a file" natural-language recap.
import {
  IcTool, IcPlug, IcSkill, IcTerminal, IcDoc, IcList, IcGlobe, IcSearch, IcScroll, IcSpawn,
} from './icons.jsx';

export function humanize(s) {
  return (s || '').replace(/[_\-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}
export function parseArgs(args) {
  try { return (typeof args === 'string' ? JSON.parse(args) : args) || {}; } catch { return {}; }
}
export function baseName(p) { return String(p || '').split('/').filter(Boolean).pop() || String(p || ''); }
export function prettyJson(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s || ''; } }

// Rich end-user-facing metadata for one tool step: icon + label (+ optional filename/kind chip).
export function toolMeta(name, args) {
  const n = name || ''; const a = parseArgs(args);
  const mcp = n.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return { Icon: IcPlug, label: `${humanize(mcp[1])} · ${humanize(mcp[2])}` };
  switch (n) {
    case 'Skill': return { Icon: IcSkill, label: 'Skill', chip: String(a.command || a.name || a.skill || a.skill_name || '') || undefined };
    case 'ToolSearch': return { Icon: IcSearch, label: 'Finding tools' };
    case 'TaskCreate': return { Icon: IcList, label: 'Added task' + (a.subject ? `: ${a.subject}` : '') };
    case 'TaskUpdate': {
      const s = String(a.status || '');
      return { Icon: IcList, label: s === 'completed' ? 'Completed task' : s === 'in_progress' ? 'Started task' : 'Updated task' };
    }
    case 'Bash': {
      const cmd = String(a.command || '');
      const label = /^\s*mkdir/.test(cmd) ? 'Create working directory' : /^\s*(cd|ls|pwd|cat|find)\b/.test(cmd) ? 'Inspected the workspace' : 'Ran a command';
      return { Icon: IcTerminal, label };
    }
    case 'Write': return { Icon: IcDoc, label: 'Wrote a file', chip: baseName(a.file_path || a.path) };
    case 'Edit': case 'MultiEdit': return { Icon: IcDoc, label: 'Edited a file', chip: baseName(a.file_path || a.path) };
    case 'Read': return { Icon: IcScroll, label: 'Read ' + (baseName(a.file_path || a.path) || 'a file') };
    case 'Glob': return { Icon: IcSearch, label: 'Found files' };
    case 'Grep': return { Icon: IcSearch, label: 'Searched code' };
    case 'LS': return { Icon: IcList, label: 'Listed files' };
    case 'WebSearch': return { Icon: IcGlobe, label: 'Searched the web' };
    case 'WebFetch': return { Icon: IcGlobe, label: 'Fetched a web page' };
    case 'Task': case 'Agent': return { Icon: IcSpawn, label: 'Ran a sub-agent' };
    default: return { Icon: IcTool, label: humanize(n) };
  }
}

// Natural-language summary for a group of steps, counted per operation type and concatenated,
// e.g. "Ran 5 commands" or "Ran 5 commands, read 2 files, wrote a file".
export function summarizeSteps(steps) {
  // name -> a stable category key (Edit/MultiEdit collapse; mcp__*/unknown -> 'tool')
  const catOf = (n) => {
    if (/^mcp__/.test(n)) return 'tool';
    return ({ Bash: 'bash', Write: 'write', Edit: 'edit', MultiEdit: 'edit', Read: 'read', Glob: 'glob',
      Grep: 'grep', LS: 'ls', WebSearch: 'websearch', WebFetch: 'webfetch', Task: 'agent', Agent: 'agent',
      ToolSearch: 'toolsearch', Skill: 'skill', TaskCreate: 'taskcreate', TaskUpdate: 'taskupdate' })[n] || 'tool';
  };
  // category -> phrase(count). Lowercase; the first word of the whole summary is capitalized below.
  const phrase = (cat, c) => {
    const one = c === 1;
    switch (cat) {
      case 'bash': return one ? 'ran a command' : `ran ${c} commands`;
      case 'write': return one ? 'wrote a file' : `wrote ${c} files`;
      case 'edit': return one ? 'edited a file' : `edited ${c} files`;
      case 'read': return one ? 'read a file' : `read ${c} files`;
      case 'grep': return one ? 'searched code' : `searched code ${c} times`;
      case 'glob': return 'found files';
      case 'ls': return 'listed files';
      case 'websearch': return one ? 'searched the web' : `searched the web ${c} times`;
      case 'webfetch': return one ? 'fetched a page' : `fetched ${c} pages`;
      case 'agent': return one ? 'ran a sub-agent' : `ran ${c} sub-agents`;
      case 'toolsearch': return 'loaded tools';
      case 'skill': return one ? 'used a skill' : `used ${c} skills`;
      case 'taskcreate': return one ? 'added a task' : `added ${c} tasks`;
      case 'taskupdate': return one ? 'updated a task' : `updated ${c} tasks`;
      default: return one ? 'used a tool' : `used ${c} tools`;
    }
  };
  // count per category, preserving first-seen order
  const order = [];
  const counts = {};
  for (const s of steps) {
    const cat = catOf(s.name || '');
    if (!(cat in counts)) { counts[cat] = 0; order.push(cat); }
    counts[cat]++;
  }
  if (order.length === 0) return 'Working…';
  const parts = order.map((cat) => phrase(cat, counts[cat]));
  const j = parts.join(', ');
  return j.charAt(0).toUpperCase() + j.slice(1);
}
