// The mention model: what a mention input holds, how it is written down, and how a menu is
// searched. Pure functions, no DOM, no React, so the same code serves the editor, the
// read-only renderer of a stored message, and a test.
//
// A value is a plain string with tokens in it. The token format belongs to the host:
//   { open: '{{', close: '}}' }   a sheet prompt: "Grade {{Answer}} against {{Gold}}"
//   { open: '@',  close: ''   }   a chat message: "@Project Manager can you take CT-281"
// A token names the item (its `name`), so the string stays readable wherever it travels, and
// the editor keeps a `mentions` list beside it ({id, name, kind}) so a host never parses text
// to learn who was mentioned.

export const CURLY = Object.freeze({ open: '{{', close: '}}' });
export const AT = Object.freeze({ open: '@', close: '' });
// A chat message carries the id too, as a markdown link a sanitizer lets through:
//   [@Project Manager](#m-member.bot.project_manager)
export const CHAT_LINK = Object.freeze({
  write: (item) => `[@${item.name}](#m-${item.id})`,
  pattern: /\[@(?<name>[^\]\n]+)\]\(#m-(?<id>[^)\s]+)\)/g,
});

/** A resolver answers `name -> item | null`. Built from the items a host offers, longest names
 *  first, so "@Project Manager" is not read as "@Project" + " Manager". */
export function makeResolver(items) {
  const byName = new Map();
  const byId = new Map();
  for (const it of items || []) {
    if (!it) continue;
    if (it.name) byName.set(it.name, it);
    if (it.id != null) byId.set(String(it.id), it);
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  return { get: (name) => byName.get(name) || null, byId: (id) => byId.get(String(id)) || null, names };
}

// A token spelled with its id parses even when the item is not offered any more (a member who
// left, a column since renamed): the name in the token is what is shown.
function parsePattern(text, format, resolver) {
  const out = [];
  const re = new RegExp(format.pattern.source, format.pattern.flags.includes('g') ? format.pattern.flags : format.pattern.flags + 'g');
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const id = m.groups && m.groups.id != null ? m.groups.id : null;
    const name = (m.groups && m.groups.name) || '';
    const item = (id != null && resolver && resolver.byId(id)) || (resolver && resolver.get(name)) || { id: id ?? name, name, kind: null };
    out.push({ type: 'mention', id: item.id, name: item.name || name, kind: item.kind || null, item });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** value -> segments: [{ type: 'text', text }] and [{ type: 'mention', id, name, kind, item }].
 *  Only names the resolver knows become mentions; anything else stays text, verbatim. */
export function parseValue(value, format, resolver) {
  const text = value == null ? '' : String(value);
  if (format && format.pattern) return parsePattern(text, format, resolver);
  const { open, close } = format || CURLY;
  const out = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { out.push({ type: 'text', text: buf }); buf = ''; } };
  while (i < text.length) {
    if (resolver && text.startsWith(open, i)) {
      // At a word boundary for the bare "@" form: "email@host" is not a mention.
      const boundary = close ? true : (i === 0 || /[\s([{"'>]/.test(text[i - 1]));
      let hit = null;
      if (boundary) {
        for (const name of resolver.names) {
          const start = i + open.length;
          if (text.startsWith(name, start)) {
            const end = start + name.length;
            if (!close || text.startsWith(close, end)) {
              // the bare form must end at a word boundary too
              if (close || end === text.length || /[\s.,;:!?)\]}"']/.test(text[end])) { hit = { name, end: end + close.length }; break; }
            }
          }
        }
      }
      if (hit) {
        flush();
        const item = resolver.get(hit.name);
        out.push({ type: 'mention', id: item.id, name: item.name, kind: item.kind || null, item });
        i = hit.end;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return out;
}

/** segments -> value string in the host's format. */
export function serializeSegments(segments, format) {
  const f = format || CURLY;
  if (f.write) return (segments || []).map((s) => (s.type === 'mention' ? f.write(s.item || s) : s.text)).join('');
  const { open, close } = f;
  return (segments || []).map((s) => (s.type === 'mention' ? `${open}${s.name}${close}` : s.text)).join('');
}

/** The distinct mentions in a segment list, in order of first appearance. */
export function mentionsOf(segments) {
  const seen = new Set();
  const out = [];
  for (const s of segments || []) {
    if (s.type !== 'mention' || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, name: s.name, kind: s.kind || null });
  }
  return out;
}

// ── search ──────────────────────────────────────────────────────────────────
// Free text over name, description and keywords. A name that starts with the query ranks
// first, then a word of the name, then anything containing it, then a subsequence (typing
// "pm" finds "Project Manager"); a description or keyword match trails the name matches.
function norm(s) { return String(s || '').toLowerCase(); }

function subsequence(hay, needle) {
  let j = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) if (hay[i] === needle[j]) j++;
  return j === needle.length;
}

export function scoreItem(item, query) {
  const q = norm(query).trim();
  if (!q) return 1;
  const name = norm(item.name);
  if (name === q) return 120;
  if (name.startsWith(q)) return 100;
  if (name.split(/[\s_-]+/).some((w) => w.startsWith(q))) return 80;
  if (name.includes(q)) return 60;
  const initials = name.split(/[\s_-]+/).map((w) => w[0]).join('');
  if (initials.startsWith(q)) return 50;
  if (subsequence(name, q)) return 30;
  const desc = norm(item.description);
  if (desc && desc.includes(q)) return 20;
  const kws = (item.keywords || []).map(norm);
  if (kws.some((k) => k.includes(q))) return 15;
  return 0;
}

/** Items that match, best first, stable within a score (host order wins ties). */
export function searchItems(items, query) {
  const scored = (items || []).map((it, i) => ({ it, i, s: scoreItem(it, query) })).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map((x) => x.it);
}

/** Matching items grouped by section, sections in the order the host listed them
 *  (items without a section share the unnamed group, first). */
export function groupItems(items, query) {
  const groups = new Map();
  for (const it of searchItems(items, query)) {
    const key = it.section || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const order = [''];
  for (const it of items || []) { const k = it.section || ''; if (!order.includes(k)) order.push(k); }
  return order.filter((k) => groups.has(k)).map((k) => ({ section: k, items: groups.get(k) }));
}

/** Where a trigger is live in a piece of text ending at the caret: the query typed after it,
 *  or null. A trigger counts only at a word start and only while the query has no line break
 *  and is not too long to be a name someone is still typing. */
export function activeTrigger(textBeforeCaret, trigger = '@', maxLen = 48) {
  const at = textBeforeCaret.lastIndexOf(trigger);
  if (at < 0) return null;
  if (at > 0 && !/[\s([{"'>]/.test(textBeforeCaret[at - 1])) return null;
  const query = textBeforeCaret.slice(at + trigger.length);
  if (query.length > maxLen || /\n/.test(query)) return null;
  return { start: at, query };
}
