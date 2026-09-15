// MentionInput — a text field that can hold people, columns, files: anything a host offers.
//
// Type the trigger ("@" by default) and a menu opens at the caret with the host's items, searched
// as you type (name, description, keywords). Pick one and it becomes a pill in the text: one
// unit to the caret and to Backspace, with its icon and name, tinted by kind. Underneath, the
// value is a plain string in the host's token format ({{Name}} for a sheet prompt, @Name for a
// chat message) and a `mentions` list rides beside it, so a host never parses text to learn who
// was mentioned. Loading a value turns the tokens it can resolve back into pills.
//
//   items       [{ id, name, kind?, section?, description?, keywords?, icon?, avatar?, color?,
//                 disabled? (true | 'reason'), tag? }]   the menu, in the host's order
//   format      { open, close }  token spelling; CURLY ({{Name}}) by default, AT for @Name
//   trigger     the character that opens the menu ('@')
//   onChange(value, mentions)
//   onSubmit()  when given with submitOnEnter, Enter submits and Shift+Enter breaks the line
//   ref         { focus(), insertMention(item), clear(), el }
//
// The editor is a contentEditable whose DOM is read back into the model on every input; the
// menu is a Popover anchored to the caret. No dependency beyond react and react-dom.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '../components/Popover.jsx';
import { CURLY, makeResolver, parseValue, serializeSegments, mentionsOf, groupItems, activeTrigger } from './mentionModel.js';

const MENTION_ATTR = 'data-mention-id';

function monogram(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '') || '?';
}

// The pill, as a DOM node (the editor is not React-managed inside).
export function buildPillNode(item) {
  const el = document.createElement('span');
  el.className = 'uic-mention';
  el.setAttribute(MENTION_ATTR, item.id);
  el.setAttribute('data-name', item.name);
  if (item.kind) el.setAttribute('data-kind', item.kind);
  el.setAttribute('contenteditable', 'false');
  if (item.description) el.title = item.description;
  if (item.color) el.style.setProperty('--uic-mention-color', item.color);
  const ic = document.createElement('span');
  ic.className = 'uic-mention-ic';
  if (item.avatar) { const img = document.createElement('img'); img.src = item.avatar; img.alt = ''; ic.appendChild(img); }
  else { ic.textContent = typeof item.icon === 'string' && item.icon ? item.icon : monogram(item.name); if (!(typeof item.icon === 'string' && item.icon)) ic.classList.add('is-mono'); }
  const nm = document.createElement('span');
  nm.className = 'uic-mention-name';
  nm.textContent = item.name;
  el.appendChild(ic);
  el.appendChild(nm);
  return el;
}

// DOM -> segments. Text nodes are text, <br> and block boundaries are line breaks, a pill is a
// mention; the browser's own trailing <br> (it keeps one so the last empty line can be reached)
// is not a newline of the user's.
function readSegments(root, resolver) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ type: 'text', text: buf }); buf = ''; } };
  const walk = (node, isLastAtRoot) => {
    const kids = Array.from(node.childNodes);
    kids.forEach((k, i) => {
      const last = isLastAtRoot && i === kids.length - 1;
      // a contentEditable writes a trailing space as a no-break space; the value keeps plain ones
      if (k.nodeType === 3) { buf += k.data.replace(/\u00a0/g, ' '); return; }
      if (k.nodeType !== 1) return;
      const tag = k.tagName;
      if (tag === 'BR') { if (!last) buf += '\n'; return; }
      if (k.hasAttribute(MENTION_ATTR)) {
        flush();
        const id = k.getAttribute(MENTION_ATTR);
        const name = k.getAttribute('data-name') || '';
        const item = resolver.get(name) || { id, name, kind: k.getAttribute('data-kind') || null };
        out.push({ type: 'mention', id: item.id, name: item.name, kind: item.kind || null, item });
        return;
      }
      if (tag === 'DIV' || tag === 'P') {
        // a block after other content starts a new line
        if (out.length || buf) buf += '\n';
        walk(k, last);
        return;
      }
      walk(k, last);
    });
  };
  walk(root, true);
  flush();
  return out;
}

// segments -> DOM
function writeSegments(root, segments) {
  root.textContent = '';
  for (const s of segments) {
    if (s.type === 'mention') { root.appendChild(buildPillNode(s.item || s)); continue; }
    const lines = String(s.text).split('\n');
    lines.forEach((line, i) => {
      if (i > 0) root.appendChild(document.createElement('br'));
      if (line) root.appendChild(document.createTextNode(line));
    });
  }
  // the reachable last line
  root.appendChild(document.createElement('br'));
}

function placeCaretAfter(node) {
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.setStartAfter(node);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function selectionIn(root) {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  return { sel, range: r };
}

export const MentionInput = forwardRef(function MentionInput(props, ref) {
  const {
    value = '', onChange, items = [], format = CURLY, trigger = '@', placeholder, disabled = false,
    onSubmit, submitOnEnter = false, autoFocus = false, className = '', label, menuWidth = 360,
    menuTitle, emptyText = 'No match', renderIcon, onOpenChange, onFocus, onBlur, onKeyDown, id,
  } = props;
  const editorRef = useRef(null);
  const resolver = useMemo(() => makeResolver(items), [items]);
  const [menu, setMenu] = useState(null);          // { node, start, query, rect }
  const [active, setActive] = useState(0);
  const [empty, setEmpty] = useState(!value);
  const listId = useMemo(() => `uic-mention-${Math.random().toString(36).slice(2, 8)}`, []);

  // ── model <-> DOM ──
  const emit = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const segs = readSegments(root, resolver);
    const next = serializeSegments(segs, format);
    setEmpty(!next);
    if (onChange) onChange(next, mentionsOf(segs));
  }, [resolver, format, onChange]);

  // A value that arrives from outside (a reset after send, a loaded prompt) is drawn; the one
  // the editor just emitted is already on screen, so the caret is left alone.
  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    const current = serializeSegments(readSegments(root, resolver), format);
    if (current === (value || '')) return;
    writeSegments(root, parseValue(value || '', format, resolver));
    setEmpty(!value);
  }, [value, resolver, format]);

  useEffect(() => { if (autoFocus && editorRef.current) editorRef.current.focus(); }, [autoFocus]);

  // ── the menu at the caret ──
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => { if (onOpenChange) onOpenChange(!!menu); }, [menu, onOpenChange]);
  const groups = useMemo(() => (menu ? groupItems(items, menu.query) : []), [items, menu]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => { setActive(0); }, [menu && menu.query, groups.length]);

  const syncMenu = useCallback(() => {
    const root = editorRef.current;
    const s = root && selectionIn(root);
    if (!s || !s.range.collapsed) { setMenu(null); return; }
    const node = s.range.startContainer;
    if (node.nodeType !== 3) { setMenu(null); return; }
    const hit = activeTrigger(node.data.slice(0, s.range.startOffset), trigger);
    if (!hit) { setMenu(null); return; }
    const r = document.createRange();
    r.setStart(node, hit.start);
    r.setEnd(node, Math.min(node.data.length, hit.start + 1));
    const rect = r.getBoundingClientRect();
    setMenu({ node, start: hit.start, query: hit.query, rect: rect.width || rect.height ? rect : root.getBoundingClientRect() });
  }, [trigger]);

  const anchorRef = useMemo(() => ({
    current: {
      getBoundingClientRect: () => (menu ? menu.rect : new DOMRect()),
      contains: () => false,
    },
  }), [menu]);

  const insertPill = useCallback((item, replace) => {
    const root = editorRef.current;
    if (!root || !item || item.disabled) return;
    const pill = buildPillNode(item);
    const space = document.createTextNode(' ');
    if (replace && replace.node && replace.node.parentNode === root) {
      const { node, start, query } = replace;
      node.deleteData(start, trigger.length + query.length);
      const after = node.splitText(start);
      root.insertBefore(pill, after);
      root.insertBefore(space, after);
    } else {
      const s = selectionIn(root);
      if (s) { s.range.deleteContents(); s.range.insertNode(space); s.range.insertNode(pill); }
      else { root.appendChild(pill); root.appendChild(space); }
    }
    placeCaretAfter(space);
    setMenu(null);
    emit();
  }, [emit, trigger]);

  const pick = useCallback((item) => insertPill(item, menu), [insertPill, menu]);

  const insertText = useCallback((text) => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    let done = false;
    try { done = document.execCommand('insertText', false, text); } catch { done = false; }
    if (!done) {
      const s = selectionIn(root);
      const tn = document.createTextNode(text);
      if (s) { s.range.deleteContents(); s.range.insertNode(tn); placeCaretAfter(tn); }
      else root.appendChild(tn);
    }
    emit();
    syncMenu();
  }, [emit, syncMenu]);

  // Markdown helpers for a host's formatting row: wrap what is selected (or leave the caret
  // between the marks), or start the current line with a prefix.
  const wrapSelection = useCallback((before, after = '') => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    const s = selectionIn(root);
    const selected = s ? s.range.toString() : '';
    insertText(before + selected + after);
    if (!selected && after) {
      const sel = window.getSelection();
      for (let i = 0; i < after.length; i++) sel && sel.modify && sel.modify('move', 'backward', 'character');
    }
  }, [insertText]);
  const prefixLine = useCallback((prefix) => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();
    const s = selectionIn(root);
    const node = s && s.range.startContainer;
    const before = node && node.nodeType === 3 ? node.data.slice(0, s.range.startOffset) : '';
    const atLineStart = !before || /\n$/.test(before) || (node && node.nodeType !== 3);
    insertText((atLineStart ? '' : '\n') + prefix);
  }, [insertText]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current && editorRef.current.focus(),
    clear: () => { const root = editorRef.current; if (root) { writeSegments(root, []); emit(); } },
    insertMention: (item) => insertPill(item, null),
    insertText,
    wrapSelection,
    prefixLine,
    get el() { return editorRef.current; },
  }), [emit, insertPill, insertText, wrapSelection, prefixLine]);

  // ── events ──
  const handleInput = () => { emit(); syncMenu(); };
  const handleKeyDown = (e) => {
    if (onKeyDown) onKeyDown(e);
    if (e.defaultPrevented) return;
    if (menu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (flat.length ? (a + 1) % flat.length : 0)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && flat.length) { e.preventDefault(); pick(flat[active]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === 'Enter') {
      if (submitOnEnter && !e.shiftKey) { e.preventDefault(); if (onSubmit) onSubmit(); return; }
      e.preventDefault();
      insertText('\n');
    }
  };
  const handlePaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    if (!text) return;
    // pasted tokens the host knows become pills, the rest stays text
    const segs = parseValue(text, format, resolver);
    if (segs.every((s) => s.type === 'text')) { insertText(text); return; }
    const root = editorRef.current;
    const s = selectionIn(root);
    if (!s) { insertText(text); return; }
    s.range.deleteContents();
    const frag = document.createDocumentFragment();
    let lastNode = null;
    for (const seg of segs) {
      if (seg.type === 'mention') { lastNode = buildPillNode(seg.item || seg); frag.appendChild(lastNode); continue; }
      seg.text.split('\n').forEach((line, i) => {
        if (i > 0) { lastNode = document.createElement('br'); frag.appendChild(lastNode); }
        if (line) { lastNode = document.createTextNode(line); frag.appendChild(lastNode); }
      });
    }
    s.range.insertNode(frag);
    if (lastNode) placeCaretAfter(lastNode);
    emit();
    syncMenu();
  };
  const handleBlur = (e) => { if (onBlur) onBlur(e); };
  const handleFocus = (e) => { if (onFocus) onFocus(e); };

  // the caret moving away from the trigger (a click, an arrow) closes the menu
  useEffect(() => {
    if (!menu) return undefined;
    const onSel = () => syncMenu();
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [menu, syncMenu]);

  // the active option stays in view: the list scrolls, never the page (scrollIntoView can
  // move the document under a host that watches it)
  useEffect(() => {
    if (!menu) return;
    const el = document.getElementById(`${listId}-${active}`);
    const list = el && el.closest('.uic-mention-menu');
    if (!el || !list) return;
    const top = el.offsetTop - list.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [active, menu, listId]);

  const iconOf = (item) => {
    if (renderIcon) { const n = renderIcon(item); if (n) return n; }
    if (item.avatar) return <img src={item.avatar} alt="" />;
    if (typeof item.icon === 'string' && item.icon) return item.icon;
    if (item.icon) return item.icon;
    return <span className="is-mono">{monogram(item.name)}</span>;
  };

  let index = -1;
  return (
    <div className={['uic-mention-field', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')}>
      <div
        ref={editorRef}
        id={id}
        className={'uic-mention-editor' + (empty ? ' is-empty' : '')}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={!!menu}
        aria-controls={menu ? listId : undefined}
        aria-activedescendant={menu && flat.length ? `${listId}-${active}` : undefined}
        data-placeholder={placeholder || ''}
        spellCheck="true"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      <Popover open={!!menu} anchorRef={anchorRef} onClose={closeMenu} width={menuWidth} minHeight={120} className="uic-mention-pop" label={menuTitle || 'Mentions'}>
        <div className="uic-mention-menu" role="listbox" id={listId} onMouseDown={(e) => e.preventDefault()}>
          {menuTitle ? <div className="uic-mention-head">{menuTitle}</div> : null}
          {groups.map((g) => (
            <div className="uic-mention-group" key={g.section || '_'}>
              {g.section ? <div className="uic-mention-sec">{g.section}</div> : null}
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const dis = !!item.disabled;
                const reason = typeof item.disabled === 'string' ? item.disabled : null;
                return (
                  <button
                    key={item.id} type="button" id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-disabled={dis || undefined}
                    className={'uic-mention-item' + (i === active ? ' is-active' : '') + (dis ? ' is-disabled' : '')}
                    style={item.color ? { '--uic-mention-color': item.color } : undefined}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => { if (!dis) pick(item); }}
                  >
                    <span className="uic-mention-ic">{iconOf(item)}</span>
                    <span className="uic-mention-text">
                      <span className="uic-mention-name">{item.name}</span>
                      {item.description ? <span className="uic-mention-desc">{item.description}</span> : null}
                    </span>
                    {reason || item.tag ? <span className="uic-mention-tag">{reason || item.tag}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {!flat.length ? <div className="uic-mention-empty">{emptyText}</div> : null}
        </div>
      </Popover>
    </div>
  );
});

// Read-only: a stored value drawn with its pills, for a message or a preview.
export function MentionText({ value, items = [], format = CURLY, className = '', renderIcon }) {
  const resolver = useMemo(() => makeResolver(items), [items]);
  const segs = useMemo(() => parseValue(value || '', format, resolver), [value, format, resolver]);
  return (
    <span className={['uic-mention-text-view', className].filter(Boolean).join(' ')}>
      {segs.map((s, i) => {
        if (s.type === 'text') return <React.Fragment key={i}>{s.text}</React.Fragment>;
        const item = s.item || s;
        const icon = renderIcon ? renderIcon(item) : null;
        return (
          <span key={i} className="uic-mention" data-kind={s.kind || undefined} title={item.description || undefined}
                style={item.color ? { '--uic-mention-color': item.color } : undefined}>
            <span className={'uic-mention-ic' + (icon || (typeof item.icon === 'string' && item.icon) || item.avatar ? '' : ' is-mono')}>
              {icon || (item.avatar ? <img src={item.avatar} alt="" /> : (typeof item.icon === 'string' && item.icon ? item.icon : monogram(item.name)))}
            </span>
            <span className="uic-mention-name">{s.name}</span>
          </span>
        );
      })}
    </span>
  );
}
