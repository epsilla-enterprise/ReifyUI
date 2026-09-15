// SheetGrid — the reusable AI-spreadsheet grid (UI Core).
//
// Product-agnostic: it renders a sheet JSON and calls back for edits/runs.
// The Sheets product (frontend-sheets) AND agentstudio studio Spaces both
// mount it via @ui-core, so a Space can nest a sheet-typed element with the
// same component. All I/O is injected — this file has no product API.
//
// Sheet shape (see backend/sheets sheet_model):
//   { meta{title,rev}, columns[{id,name,type,options?,compute?}],
//     rows[{id}], cells{ "<rowId>:<colId>": {value,status,error} } }
//
// Props:
//   sheet       — the sheet JSON (required)
//   onRunCell(rowId, colId) — run one computed cell (optional)
//   ops                     — the document ops (useSheetCollab's sheetOps); every
//                             edit is one op on this tab, never a whole-sheet replace
//   onRunColumn(colId)      — batch-run a computed column (optional)
//   peers       — this tab's other people: [{id, name, color, sel, typing}] (from
//                 useSheetCollab); their selection is outlined and tinted in
//                 their color, their in-progress text shows in the cell as they type
//   onPresence  — ({sel, typing}) what THIS person selects and types, for peers
//   readOnly    — no editing/running (template previews / embedded read views)
//   fetchBlobUrl(path)      — async product-authed fetch -> object URL, for
//                             inline images whose url is a product path
//   onOpenResource(ref)     — open a referenced artifact (sheet/slides/…)
//
// Editing goes straight to the document: local edits are ops on it; the
// host persists + (via realtime) rebroadcasts truth back through `sheet`.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MentionInput } from '../mention/MentionInput.jsx';
import { createPortal } from 'react-dom';
import { withAlpha } from '../collab/colors.js';

const cellKey = (rowId, colId) => `${rowId}:${colId}`;
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

const TYPE_LABEL = {
  text: 'Text', number: 'Number', select: 'Select', tags: 'Tags',
  checkbox: 'Checkbox', date: 'Date', url: 'Link', resource: 'Resource', compute: 'Computed',
};
// A one-glyph mark per column type, for pills and pickers.
const TYPE_GLYPH = { text: 'Aa', number: '#', select: '▾', tags: '#', checkbox: '✓', date: '▦', url: '↗', resource: '◫', compute: '✦' };

const MANUAL_TYPES = ['text', 'number', 'select', 'tags', 'checkbox', 'date', 'url', 'resource'];
const COMPUTE_KINDS = [
  { kind: 'prompt', label: 'AI prompt' },
  { kind: 'harness', label: 'Agent (harness)' },
  { kind: 'workflow', label: 'Workflow' },
  { kind: 'image', label: 'Generate image' },
];
const RESOURCE_KINDS = ['image', 'sheet', 'slides', 'workflow', 'graph'];
const RESOURCE_ICON = { image: '🖼', sheet: '▦', slides: '▤', workflow: '⚙', graph: '◉' };

// Popovers render through a body portal with FIXED positioning — inside the
// grid they'd be clipped by the scroll container and out-stacked by the
// sticky header/row-number cells. anchor is a DOMRect captured at open time;
// the box clamps to the viewport and flips above the anchor when the bottom
// would overflow. A scroll OUTSIDE the box closes it (the anchor moved);
// scrolling inside it (a long prompt, a long option list) is the box's own.
function PopPortal({ anchor, width = 250, estHeight = 300, className, children, onClose }) {
  const boxRef = useRef(null);
  useEffect(() => {
    if (!onClose) return undefined;
    const close = (e) => {
      if (e?.type === 'scroll' && boxRef.current && e.target instanceof Node && boxRef.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [onClose]);
  if (!anchor) return null;
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  let top = anchor.bottom + 6;
  if (top + estHeight > window.innerHeight - 8) top = Math.max(8, anchor.top - estHeight - 6);
  return createPortal(
    <div ref={boxRef} className={className} style={{ position: 'fixed', top, left, width, zIndex: 1000 }}>
      {children}
    </div>,
    document.body,
  );
}

// Value styling. A column's `options` are its value vocabulary: each option is
// a value and a color. A select column offers them as choices; EVERY column
// type paints a cell whose value matches one as a pill in that color, so an
// enumerated result (CORRECT / WRONG, HEALTHY / AT RISK) reads at a glance.
// The palette is named so a color can mean something; an option that declares
// no color takes the muted rotation.
export const PILL_PALETTE = [
  { name: 'green', color: '#D1FAE5' }, { name: 'red', color: '#FEE2E2' },
  { name: 'amber', color: '#FEF3C7' }, { name: 'blue', color: '#DBEAFE' },
  { name: 'purple', color: '#EDE9FE' }, { name: 'pink', color: '#FCE7F3' },
  { name: 'teal', color: '#CCFBF1' }, { name: 'gray', color: '#E5E7EB' },
];
const PILL_FALLBACKS = ['#E0E7FF', '#FCE7F3', '#D1FAE5', '#FEF3C7', '#E0F2FE', '#F3E8FF', '#FFE4E6'];

export function normOptions(options) {
  return (options || []).map((o, i) => {
    if (typeof o === 'string') return { label: o, color: PILL_FALLBACKS[i % PILL_FALLBACKS.length] };
    return { label: o.label ?? String(o.value ?? ''), color: o.color || PILL_FALLBACKS[i % PILL_FALLBACKS.length] };
  });
}

const sameValue = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** The option a value matches (trimmed, case-insensitive), or null. */
function optionFor(value, options) {
  if (value === undefined || value === null || value === '') return null;
  return normOptions(options).find((o) => sameValue(o.label, value)) || null;
}

function pillColor(label, options) {
  const hit = optionFor(label, options);
  if (hit) return hit.color;
  // stable fallback by hash so ad-hoc tags keep their color
  let h = 0;
  for (const ch of String(label)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PILL_FALLBACKS[h % PILL_FALLBACKS.length];
}

// An inline image whose url may be a product path (needs authed fetch).
function RefImage({ refVal, fetchBlobUrl }) {
  const [src, setSrc] = useState(/^https?:\/\//i.test(refVal.url || '') ? refVal.url : null);
  useEffect(() => {
    let dead = false; let obj = null;
    if (!src && refVal.url && fetchBlobUrl) {
      fetchBlobUrl(refVal.url).then((u) => { if (!dead) { obj = u; setSrc(u); } });
    }
    return () => { dead = true; if (obj) URL.revokeObjectURL(obj); };
  }, [refVal.url]);
  if (!src) return <span className="shg-refchip">{RESOURCE_ICON.image} {refVal.name || 'image'}</span>;
  return <img className="shg-refimg" src={src} alt={refVal.name || ''} title={refVal.name || ''} />;
}

function ResourceChip({ refVal, onOpen }) {
  const icon = RESOURCE_ICON[refVal.kind] || '◇';
  return (
    <button className="shg-refchip shg-refchip-btn" title={`Open ${refVal.kind}`}
            onClick={(e) => { e.stopPropagation(); onOpen && onOpen(refVal); }}>
      <span className="shg-refchip-ic">{icon}</span>
      <span className="shg-refchip-name">{refVal.name || refVal.id || refVal.kind}</span>
    </button>
  );
}

// A small status dot for computed cells while work is pending or went wrong;
// a finished cell is its value.
function StatusDot({ status }) {
  if (!status || status === 'empty' || status === 'done') return null;
  return <span className={`shg-dot shg-dot-${status}`} title={status} />;
}

function CellValue({ cell, col, fetchBlobUrl, onOpenResource }) {
  const v = cell?.value;
  if (v === undefined || v === null || v === '') return <span className="shg-val-txt" />;
  // A typed artifact ref renders the same whether hand-set (resource column)
  // or produced by a compute kind (e.g. Generate image).
  if (v && typeof v === 'object' && !Array.isArray(v) && v.kind) {
    if (v.kind === 'image') return <RefImage refVal={v} fetchBlobUrl={fetchBlobUrl} />;
    return <ResourceChip refVal={v} onOpen={onOpenResource} />;
  }
  const styled = col.type !== 'tags' && optionFor(v, col.options);
  if (styled) return <span className="shg-pill" style={{ background: styled.color }}>{styled.label}</span>;
  switch (col.type) {
    case 'select':
      return <span className="shg-pill" style={{ background: pillColor(String(v), col.options) }}>{String(v)}</span>;
    case 'tags': {
      const tags = Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);
      return (
        <span className="shg-pills">
          {tags.map((t) => (
            <span key={t} className="shg-pill" style={{ background: pillColor(t, col.options) }}>{t}</span>
          ))}
        </span>
      );
    }
    case 'checkbox':
      return <span className={'shg-check' + (v ? ' on' : '')}>{v ? '✓' : ''}</span>;
    case 'url': {
      const href = /^https?:\/\//i.test(String(v)) ? String(v) : `https://${v}`;
      return <a className="shg-link" href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    }
    case 'number':
      return <span className="shg-val-txt shg-num">{String(v)}</span>;
    default:
      return <span className="shg-val-txt">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>;
  }
}

export function SheetGrid({ sheet, ops, onRunCell, onRunColumn, readOnly = false, fetchBlobUrl, onOpenResource, peers, onPresence }) {
  const columns = sheet?.columns || [];
  const rows = sheet?.rows || [];
  const cells = sheet?.cells || {};
  const tabId = sheet?.id;
  const canEdit = !readOnly && !!ops && !!tabId;
  const [editing, setEditing] = useState(null);   // {rowId, colId, type}
  const [draft, setDraft] = useState('');
  const [menuCol, setMenuCol] = useState(null);   // {id, rect} of the open column menu
  const [sizeDraft, setSizeDraft] = useState({}); // live {col:{id:w}, row:{id:h}} during a drag
  const [dnd, setDnd] = useState(null);           // {kind:'col'|'row', id} being dragged
  const [dropAt, setDropAt] = useState(null);     // {kind, id, after} current drop slot
  const inputRef = useRef(null);
  const dragRef = useRef(null);
  // Selection, Google Sheets style: a click selects, a drag or Shift extends
  // the range, a double click / Enter / typing edits the focus cell. Indexes
  // into this tab's rows and columns; presence carries the ids.
  const [sel, setSel] = useState(null);           // {a:{r,c}, f:{r,c}}
  const dragSel = useRef(false);
  const rootRef = useRef(null);
  const presenceRef = useRef(onPresence);
  presenceRef.current = onPresence;
  const range = sel ? { r0: Math.min(sel.a.r, sel.f.r), r1: Math.max(sel.a.r, sel.f.r),
                        c0: Math.min(sel.a.c, sel.f.c), c1: Math.max(sel.a.c, sel.f.c) } : null;
  const inSel = (ri, ci) => !!range && ri >= range.r0 && ri <= range.r1 && ci >= range.c0 && ci <= range.c1;
  const isFocus = (ri, ci) => !!sel && sel.f.r === ri && sel.f.c === ci;
  const clampSel = (p) => ({ r: Math.max(0, Math.min(p.r, rows.length - 1)), c: Math.max(0, Math.min(p.c, columns.length - 1)) });
  const moveFocus = (dr, dc, extend) => setSel((cur) => {
    if (!cur || !rows.length || !columns.length) return cur;
    const f = clampSel({ r: cur.f.r + dr, c: cur.f.c + dc });
    return { a: extend ? cur.a : f, f };
  });
  useEffect(() => {
    const up = () => { dragSel.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  // Tell peers what this person selects and types.
  useEffect(() => {
    const fn = presenceRef.current;
    if (!fn) return;
    const ids = (p) => [rows[p.r]?.id, columns[p.c]?.id];
    fn({
      sel: sel && rows[sel.f.r] && columns[sel.f.c] ? { a: ids(sel.a), f: ids(sel.f) } : null,
      typing: editing && typeof draft === 'string' ? { key: cellKey(editing.rowId, editing.colId), text: draft } : null,
    });
  }, [sel, editing, draft, rows, columns]);
  // Peers on this tab: who has which cell in focus, which cells sit in their
  // ranges, and what they are typing where.
  const peerLayer = useMemo(() => {
    const focus = {}, tint = {}, typing = {};
    const rIdx = new Map(rows.map((r, i) => [r.id, i]));
    const cIdx = new Map(columns.map((c, i) => [c.id, i]));
    for (const p of peers || []) {
      if (p.typing && p.typing.key) typing[p.typing.key] = { text: p.typing.text, color: p.color, name: p.name };
      if (!p.sel || !p.sel.a || !p.sel.f) continue;
      const a = { r: rIdx.get(p.sel.a[0]), c: cIdx.get(p.sel.a[1]) }, f = { r: rIdx.get(p.sel.f[0]), c: cIdx.get(p.sel.f[1]) };
      if ([a.r, a.c, f.r, f.c].some((v) => v === undefined)) continue;
      focus[cellKey(p.sel.f[0], p.sel.f[1])] = p;
      for (let r = Math.min(a.r, f.r); r <= Math.max(a.r, f.r); r++) {
        for (let c = Math.min(a.c, f.c); c <= Math.max(a.c, f.c); c++) {
          const k = cellKey(rows[r].id, columns[c].id);
          if (!tint[k]) tint[k] = p.color;
        }
      }
    }
    return { focus, tint, typing };
  }, [peers, rows, columns]);

  // Drag-to-resize: live via sizeDraft, persisted into the sheet on release.
  const startResize = (e, kind, id, start) => {
    if (readOnly) return;
    e.preventDefault(); e.stopPropagation();
    const origin = kind === 'col' ? e.clientX : e.clientY;
    dragRef.current = { kind, id, start, origin, last: start };
    const onMove = (ev) => {
      const d = dragRef.current; if (!d) return;
      const delta = (d.kind === 'col' ? ev.clientX : ev.clientY) - d.origin;
      const next = Math.max(d.kind === 'col' ? 90 : 26, d.start + delta);
      d.last = next;
      setSizeDraft((sd) => ({ ...sd, [d.kind]: { ...(sd[d.kind] || {}), [d.id]: next } }));
    };
    const onUp = () => {
      const d = dragRef.current; dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      if (!d) return;
      setSizeDraft({});
      if (!canEdit) return;
      if (d.kind === 'col') { const c = columns.find((x) => x.id === d.id); if (c) ops.setColumn(tabId, { ...c, width: Math.round(d.last) }); }
      else { const r = rows.find((x) => x.id === d.id); if (r) ops.setRow(tabId, { ...r, height: Math.round(d.last) }); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = kind === 'col' ? 'col-resize' : 'row-resize';
  };
  const colWidth = (col) => (sizeDraft.col && sizeDraft.col[col.id]) || col.width || undefined;

  // Drag-to-reorder (columns by their header, rows by their number cell).
  const reorder = (kind, fromId, toId, after) => {
    if (!canEdit || fromId === toId) return;
    const arr = (kind === 'col' ? columns : rows).map((x) => x.id);
    const i = arr.indexOf(fromId);
    if (i < 0) return;
    arr.splice(i, 1);
    let j = arr.indexOf(toId);
    if (j < 0) return;
    if (after) j += 1;
    if (kind === 'col') ops.moveColumn(tabId, fromId, j); else ops.moveRow(tabId, fromId, j);
  };
  const dndProps = (kind, id) => (readOnly ? {} : {
    draggable: true,
    onDragStart: (e) => {
      if (e.target.closest && e.target.closest('.shg-resize-col, .shg-resize-row, input, button')) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `${kind}:${id}`);
      setDnd({ kind, id });
    },
    onDragOver: (e) => {
      if (!dnd || dnd.kind !== kind || dnd.id === id) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = kind === 'col' ? e.clientX > r.x + r.width / 2 : e.clientY > r.y + r.height / 2;
      setDropAt((d) => (d && d.id === id && d.after === after ? d : { kind, id, after }));
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dnd && dnd.kind === kind && dnd.id !== id) {
        const r = e.currentTarget.getBoundingClientRect();
        const after = kind === 'col' ? e.clientX > r.x + r.width / 2 : e.clientY > r.y + r.height / 2;
        reorder(kind, dnd.id, id, after);
      }
      setDnd(null); setDropAt(null);
    },
    onDragEnd: () => { setDnd(null); setDropAt(null); },
  });
  const dndClass = (kind, id) => {
    let cls = '';
    if (dnd && dnd.kind === kind && dnd.id === id) cls += ' shg-dragging';
    if (dropAt && dropAt.kind === kind && dropAt.id === id) {
      cls += dropAt.after ? (kind === 'col' ? ' shg-drop-after' : ' shg-drop-below')
                          : (kind === 'col' ? ' shg-drop-before' : ' shg-drop-above');
    }
    return cls;
  };
  // The number gutter is FIXED: sized by the digit count of the row total so
  // it never stretches (an empty grid otherwise splits the table width).
  const numW = Math.max(40, 24 + String(rows.length || 1).length * 9);
  const numStyle = { width: numW, minWidth: numW, maxWidth: numW };
  const rowHeight = (row) => (sizeDraft.row && sizeDraft.row[row.id]) || row.height || undefined;

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const setCell = (rowId, colId, value) => {
    if (!canEdit) return;
    ops.setCell(tabId, cellKey(rowId, colId), { value, status: 'done', updated_at: Math.floor(Date.now() / 1000) });
  };

  const openEdit = (rowId, col, anchorEl, initial) => {
    if (!canEdit) return;
    if (col.type === 'compute') return;   // computed cells aren't hand-edited
    if (col.type === 'checkbox') {        // toggles directly
      const cur = cells[cellKey(rowId, col.id)];
      setCell(rowId, col.id, !(cur && cur.value));
      return;
    }
    const c = cells[cellKey(rowId, col.id)];
    const v = c?.value;
    if (col.type === 'tags') setDraft(initial ?? (Array.isArray(v) ? v.join(', ') : (v || '')));
    else if (col.type === 'resource') setDraft(v && typeof v === 'object' ? v : { kind: 'sheet', name: '', id: '', url: '' });
    else setDraft(initial ?? (v == null ? '' : String(v)));
    setEditing({ rowId, colId: col.id, type: col.type, rect: anchorEl?.getBoundingClientRect?.() || null });
  };

  const commitEdit = () => {
    if (!editing) return;
    const { rowId, colId, type } = editing;
    let value = draft;
    if (type === 'number') value = draft === '' ? null : Number(draft);
    else if (type === 'tags') value = draft ? draft.split(',').map((s) => s.trim()).filter(Boolean) : [];
    setCell(rowId, colId, value);
    setEditing(null);
  };

  const addColumn = () => canEdit && ops.setColumn(tabId, { id: uid('col'), name: `Column ${columns.length + 1}`, type: 'text' });
  const addRow = () => canEdit && ops.setRow(tabId, { id: uid('row') });
  const deleteColumn = (colId) => canEdit && ops.deleteColumn(tabId, colId);
  const deleteRow = (rowId) => canEdit && ops.deleteRow(tabId, rowId);
  const renameColumn = (colId, name) => {
    const c = columns.find((x) => x.id === colId);
    if (canEdit && c) ops.setColumn(tabId, { ...c, name });
  };
  const configureColumn = (colId, patch) => {
    const c = columns.find((x) => x.id === colId);
    if (!canEdit || !c) return;
    const next = { ...c, ...patch };
    if (patch.type && patch.type !== 'compute') delete next.compute;
    ops.setColumn(tabId, next);
  };

  // The selection as text: one line per row, tab between cells.
  const cellText = (c) => {
    const v = c?.value;
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return v.name || v.url || v.id || '';
    return String(v);
  };
  const copySelection = (e) => {
    if (!range || editing) return;
    const lines = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const parts = [];
      for (let c = range.c0; c <= range.c1; c++) parts.push(cellText(cells[cellKey(rows[r].id, columns[c].id)]));
      lines.push(parts.join('\t'));
    }
    e.clipboardData.setData('text/plain', lines.join('\n'));
    e.preventDefault();
  };
  const pasteAt = (e) => {
    if (!sel || editing || !canEdit) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const now = Math.floor(Date.now() / 1000);
    const patch = {};
    const lines = text.replace(/\r/g, '').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    lines.forEach((line, dr) => line.split('\t').forEach((raw, dc) => {
      const row = rows[sel.f.r + dr], col = columns[sel.f.c + dc];
      if (!row || !col || col.type === 'compute') return;
      let value = raw;
      if (col.type === 'number') value = raw === '' ? null : Number(raw);
      else if (col.type === 'checkbox') value = /^(true|yes|1|✓)$/i.test(raw.trim());
      else if (col.type === 'tags') value = raw ? raw.split(',').map((x) => x.trim()).filter(Boolean) : [];
      patch[cellKey(row.id, col.id)] = value === null || value === '' ? null : { value, status: 'done', updated_at: now };
    }));
    if (Object.keys(patch).length) ops.setCells(tabId, patch);
    setSel({ a: sel.f, f: clampSel({ r: sel.f.r + lines.length - 1, c: sel.f.c + Math.max(...lines.map((l) => l.split('\t').length)) - 1 }) });
  };
  const clearSelection = () => {
    if (!range || !canEdit) return;
    const patch = {};
    for (let r = range.r0; r <= range.r1; r++) {
      for (let c = range.c0; c <= range.c1; c++) {
        if (columns[c].type === 'compute') continue;
        const k = cellKey(rows[r].id, columns[c].id);
        if (cells[k]) patch[k] = null;
      }
    }
    if (Object.keys(patch).length) ops.setCells(tabId, patch);
  };
  const onKeyDown = (e) => {
    if (editing || menuCol) return;
    if (!sel) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === 'c' || e.key === 'v' || e.key === 'x')) return;   // copy/paste events handle these
    const focusCell = () => ({ row: rows[sel.f.r], col: columns[sel.f.c] });
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveFocus(-1, 0, e.shiftKey); return;
      case 'ArrowDown': e.preventDefault(); moveFocus(1, 0, e.shiftKey); return;
      case 'ArrowLeft': e.preventDefault(); moveFocus(0, -1, e.shiftKey); return;
      case 'ArrowRight': e.preventDefault(); moveFocus(0, 1, e.shiftKey); return;
      case 'Tab': e.preventDefault(); moveFocus(0, e.shiftKey ? -1 : 1, false); return;
      case 'Escape': setSel(null); return;
      case 'Enter': case 'F2': {
        e.preventDefault();
        const { row, col } = focusCell();
        if (row && col) openEdit(row.id, col, rootRef.current?.querySelector(`[data-cell="${cellKey(row.id, col.id)}"]`));
        return;
      }
      case 'Delete': case 'Backspace': e.preventDefault(); clearSelection(); return;
      default:
    }
    if (!meta && !e.altKey && e.key.length === 1) {
      const { row, col } = focusCell();
      if (row && col && col.type !== 'compute' && col.type !== 'checkbox') {
        e.preventDefault();
        openEdit(row.id, col, rootRef.current?.querySelector(`[data-cell="${cellKey(row.id, col.id)}"]`), e.key);
      }
    }
  };

  // The inline editor for the editing cell, by type.
  const renderEditor = (col) => {
    if (col.type === 'resource') {
      const d = typeof draft === 'object' && draft ? draft : { kind: 'sheet' };
      const set = (k, v) => setDraft({ ...d, [k]: v });
      return (
        <PopPortal anchor={editing.rect} width={240} estHeight={230}
                   className="shg-select-pop shg-ref-pop" onClose={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()}>
          <select className="shg-menu-input" value={d.kind || 'sheet'} onChange={(e) => set('kind', e.target.value)}>
            {RESOURCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input className="shg-menu-input" placeholder="Name" value={d.name || ''} onChange={(e) => set('name', e.target.value)} />
          <input className="shg-menu-input" placeholder="Resource id (e.g. sheet.…)" value={d.id || ''} onChange={(e) => set('id', e.target.value)} />
          <input className="shg-menu-input" placeholder="or URL" value={d.url || ''} onChange={(e) => set('url', e.target.value)} />
          <div className="shg-menu-actions">
            <button className="shg-pop-clear" onClick={() => { setCell(editing.rowId, editing.colId, null); setEditing(null); }}>Clear</button>
            <button className="shg-menu-apply" onClick={() => { setCell(editing.rowId, editing.colId, d); setEditing(null); }}>Set</button>
          </div>
          </div>
        </PopPortal>
      );
    }
    if (col.type === 'select') {
      const opts = normOptions(col.options);
      return (
        <PopPortal anchor={editing.rect} width={190} estHeight={40 + opts.length * 30}
                   className="shg-select-pop" onClose={() => setEditing(null)}>
          {opts.length === 0 && <div className="shg-pop-note">No options yet — add them in the column menu.</div>}
          {opts.map((o) => (
            <button key={o.label} className="shg-pill shg-pill-btn" style={{ background: o.color }}
                    onClick={(e) => { e.stopPropagation(); setCell(editing.rowId, editing.colId, o.label); setEditing(null); }}>
              {o.label}
            </button>
          ))}
          <button className="shg-pop-clear"
                  onClick={(e) => { e.stopPropagation(); setCell(editing.rowId, editing.colId, null); setEditing(null); }}>
            Clear
          </button>
        </PopPortal>
      );
    }
    const inputType = col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text';
    return (
      <input ref={inputRef} className="shg-input" type={inputType} value={draft}
             placeholder={col.type === 'tags' ? 'tag, tag, …' : ''}
             onChange={(e) => setDraft(e.target.value)}
             onBlur={commitEdit}
             onKeyDown={(e) => {
               if (e.key === 'Enter') { e.preventDefault(); commitEdit(); moveFocus(1, 0, false); rootRef.current?.focus(); }
               else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); moveFocus(0, e.shiftKey ? -1 : 1, false); rootRef.current?.focus(); }
               else if (e.key === 'Escape') { setEditing(null); rootRef.current?.focus(); }
             }} />
    );
  };

  return (
    <div className="shg" ref={rootRef} tabIndex={0} onKeyDown={onKeyDown} onCopy={copySelection} onPaste={pasteAt}>
      <div className="shg-scroll">
        <table className="shg-table">
          <thead>
            <tr>
              <th className="shg-corner" style={numStyle} />
              {columns.map((col) => (
                <th key={col.id}
                    className={'shg-col' + (col.type === 'compute' ? ' shg-col-compute' : '') + dndClass('col', col.id)}
                    style={colWidth(col) ? { width: colWidth(col), minWidth: colWidth(col), maxWidth: colWidth(col) } : undefined}
                    {...dndProps('col', col.id)}>
                  {!readOnly && (
                    <span className="shg-resize-col" onMouseDown={(e) => startResize(e, 'col', col.id, colWidth(col) || e.currentTarget.closest('th').offsetWidth)} />
                  )}
                  <div className="shg-col-h">
                    <ColumnHeader
                      col={col} columns={columns} readOnly={readOnly}
                      menuOpen={menuCol?.id === col.id}
                      menuAnchor={menuCol?.id === col.id ? menuCol.rect : null}
                      onMenu={(e) => setMenuCol(menuCol?.id === col.id ? null
                        : { id: col.id, rect: e.currentTarget.getBoundingClientRect() })}
                      onCloseMenu={() => setMenuCol(null)}
                      onRename={renameColumn}
                      onConfigure={configureColumn}
                      onDelete={() => { setMenuCol(null); deleteColumn(col.id); }}
                      onRun={col.type === 'compute' && onRunColumn ? () => onRunColumn(col.id) : null}
                      width={colWidth(col)} />
                  </div>
                </th>
              ))}
              {!readOnly && (
                <th className="shg-add-col"><button className="shg-add" onClick={addColumn} title="Add column">+</button></th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.id}
                  style={{
                    ...(rowHeight(row) ? { height: rowHeight(row) } : null),
                    '--shg-clamp': Math.max(1, Math.floor(((rowHeight(row) || 34) - 10) / 18)),
                  }}>
                <td className={'shg-rownum' + dndClass('row', row.id)} style={numStyle}
                    title="Drag to reorder" {...dndProps('row', row.id)}>
                  <span>{ri + 1}</span>
                  {!readOnly && <button className="shg-rowdel" onClick={() => deleteRow(row.id)} title="Delete row">×</button>}
                  {!readOnly && (
                    <span className="shg-resize-row" onMouseDown={(e) => startResize(e, 'row', row.id, rowHeight(row) || e.currentTarget.closest('tr').offsetHeight)} />
                  )}
                </td>
                {columns.map((col, ci) => {
                  const key = cellKey(row.id, col.id);
                  const c = cells[key] || {};
                  const isEditing = editing && editing.rowId === row.id && editing.colId === col.id;
                  const peer = peerLayer.focus[key];
                  const ghost = !isEditing && peerLayer.typing[key];
                  const selected = inSel(ri, ci), focused = isFocus(ri, ci);
                  const shadows = [];
                  if (focused) shadows.push('inset 0 0 0 2px var(--brand, #0E7490)');
                  if (peer) shadows.push(`inset 0 0 0 2px ${peer.color}`);
                  const tint = !selected && peerLayer.tint[key];
                  return (
                    <td key={col.id} data-cell={key}
                        className={'shg-cell' + (col.type === 'compute' ? ' shg-cell-compute' : '')
                                   + (c.status && col.type === 'compute' ? ` shg-cell-${c.status}` : '')
                                   + (selected ? ' shg-sel' : '') + (focused ? ' shg-focus' : '')
                                   + (peer ? ' shg-cell-peer' : '')}
                        style={{ ...(shadows.length ? { boxShadow: shadows.join(', ') } : null),
                                 ...(tint ? { background: withAlpha(tint, 0.10) } : null) }}
                        onMouseDown={(e) => {
                          if (e.button !== 0 || isEditing) return;
                          if (editing) commitEdit();
                          const p = { r: ri, c: ci };
                          setSel((cur) => (e.shiftKey && cur ? { a: cur.a, f: p } : { a: p, f: p }));
                          dragSel.current = true;
                          e.preventDefault();
                          rootRef.current?.focus();
                        }}
                        onMouseEnter={() => { if (dragSel.current) setSel((cur) => (cur ? { a: cur.a, f: { r: ri, c: ci } } : cur)); }}
                        onClick={(e) => { if (col.type === 'checkbox' && !isEditing) openEdit(row.id, col, e.currentTarget); }}
                        onDoubleClick={(e) => { if (!isEditing) openEdit(row.id, col, e.currentTarget); }}
                        title={c.error || ''}>
                      {peer && <span className="shg-peer-flag" style={{ background: peer.color }}>{peer.name}</span>}
                      {isEditing ? renderEditor(col) : (
                        <div className="shg-val"
                             style={{ maxWidth: (colWidth(col) ? colWidth(col) - 20 : 400) }}>
                          {col.type === 'compute' && <StatusDot status={c.status} />}
                          {ghost ? (
                            <span className="shg-ghost" style={{ color: ghost.color }} title={`${ghost.name} is typing`}>{ghost.text}</span>
                          ) : (
                            <CellValue cell={c} col={col} fetchBlobUrl={fetchBlobUrl} onOpenResource={onOpenResource} />
                          )}
                          {col.type === 'compute' && !readOnly && onRunCell && (
                            <button className="shg-runcell" title="Run this cell"
                                    onClick={(e) => { e.stopPropagation(); onRunCell(row.id, col.id); }}>▶</button>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                {!readOnly && <td className="shg-pad" />}
              </tr>
            ))}
            {!readOnly && (
              <tr className="shg-ghost-row" onClick={addRow}>
                <td className="shg-rownum shg-ghost-num" style={numStyle}>+</td>
                <td className="shg-ghost-cell" colSpan={columns.length + 1}>New row</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnHeader({ col, columns, readOnly, menuOpen, menuAnchor, onMenu, onCloseMenu, onRename, onConfigure, onDelete, onRun, width }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(col.name);
  useEffect(() => setName(col.name), [col.name]);
  // A narrow column keeps its name: the caption goes first, then the Run label.
  const w = Number(width) || 0;
  const fit = w && w < 160 ? ' tight' : w && w < 200 ? ' narrow' : '';
  return (
    <div className={'shg-colhdr' + fit}>
      <div className="shg-colhdr-main">
        {editing && !readOnly ? (
          <input className="shg-colname-input" value={name} autoFocus
                 onChange={(e) => setName(e.target.value)}
                 onBlur={() => { setEditing(false); if (name.trim() && name !== col.name) onRename(col.id, name.trim()); }}
                 onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
        ) : (
          <span className="shg-colname" onDoubleClick={() => !readOnly && setEditing(true)} title={col.name}>{col.name}</span>
        )}
        <span className={'shg-coltype' + (col.type === 'compute' ? ' compute' : '')}>
          {TYPE_LABEL[col.type] || col.type}
          {col.type === 'compute' && col.compute?.kind ? ` · ${col.compute.kind}` : ''}
        </span>
      </div>
      {!readOnly && (
        <div className="shg-colhdr-tools">
          {onRun && <button className="shg-colrun" onClick={onRun} title="Run this column" aria-label="Run this column">▶<span className="shg-colrun-label"> Run</span></button>}
          <button className="shg-colmenu-btn" onClick={(e) => onMenu(e)} title="Column settings">⋯</button>
        </div>
      )}
      {menuOpen && !readOnly && (
        <ColumnMenu col={col} columns={columns} anchor={menuAnchor}
                    onApply={(patch) => { onConfigure(col.id, patch); onCloseMenu(); }}
                    onDelete={onDelete} onClose={onCloseMenu} />
      )}
    </div>
  );
}

// The column's values as pills in one field: type a value and press Enter or
// comma to add it, Backspace on an empty field removes the last, and clicking
// a pill opens the palette to pick its color. Select and tags columns offer
// these as choices; every column paints a matching value in its color.
function ValuePills({ values, onChange }) {
  const [text, setText] = useState('');
  const [picking, setPicking] = useState(null);   // index of the pill whose palette is open
  const add = () => {
    const label = text.trim();
    if (!label) return;
    if (!values.some((v) => sameValue(v.label, label))) onChange([...values, { label }]);
    setText('');
  };
  const remove = (i) => { onChange(values.filter((_, j) => j !== i)); setPicking(null); };
  const paint = (i, color) => { onChange(values.map((v, j) => (j === i ? { ...v, color } : v))); setPicking(null); };
  return (
    <div className="shg-values" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.querySelector('input')?.focus(); }}>
      {values.map((v, i) => (
        <span key={v.label} className="shg-value">
          <button type="button" className="shg-pill shg-pill-btn"
                  style={{ background: v.color || PILL_FALLBACKS[i % PILL_FALLBACKS.length] }}
                  title="Pick a color" aria-expanded={picking === i}
                  onClick={(e) => { e.stopPropagation(); setPicking(picking === i ? null : i); }}>
            {v.label}
            <span className="shg-value-x" role="button" aria-label={`Remove ${v.label}`}
                  onClick={(e) => { e.stopPropagation(); remove(i); }}>×</span>
          </button>
          {picking === i && (
            <span className="shg-swatches" role="listbox" aria-label={`Color for ${v.label}`}>
              {PILL_PALETTE.map((p) => (
                <button key={p.name} type="button" role="option" aria-selected={v.color === p.color}
                        className={'shg-swatch' + (v.color === p.color ? ' on' : '')}
                        style={{ background: p.color }} title={p.name}
                        onClick={(e) => { e.stopPropagation(); paint(i, p.color); }} />
              ))}
            </span>
          )}
        </span>
      ))}
      <input className="shg-values-input" value={text} placeholder={values.length ? '' : 'Type a value, press Enter'}
             onChange={(e) => setText(e.target.value)}
             onKeyDown={(e) => {
               if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
               else if (e.key === 'Backspace' && !text && values.length) remove(values.length - 1);
             }}
             onBlur={add} />
    </div>
  );
}

// The column configuration popover: type, options (select/tags), and the
// compute mount (prompt / harness / workflow + deps). Product-agnostic —
// plain controlled inputs, applied as one patch.
function ColumnMenu({ col, columns, anchor, onApply, onDelete, onClose }) {
  const [type, setType] = useState(col.type || 'text');
  // The column's values, in order, each with the color it was given (or none).
  const [values, setValues] = useState(() => (col.options || []).map((o) =>
    (typeof o === 'string' ? { label: o } : { label: o.label ?? String(o.value ?? ''), ...(o.color ? { color: o.color } : {}) })));
  const comp = col.compute || {};
  const [kind, setKind] = useState(comp.kind || 'prompt');
  const [prompt, setPrompt] = useState(comp.prompt || '');
  const [harnessId, setHarnessId] = useState(comp.harness_id || '');
  const [wfSlug, setWfSlug] = useState(comp.workflow_slug || '');
  const [outKey, setOutKey] = useState(comp.output_key || '');
  const [deps, setDeps] = useState(new Set(comp.deps || []));
  const ref = useRef(null);

  useEffect(() => {
    // a press inside the prompt's mention menu (a portal on the body) is not "outside"
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !(e.target.closest && e.target.closest('.uic-pop'))) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // What the prompt may read: the columns to the LEFT of this one (a row fills left to right,
  // so those hold values when this cell computes). The rest are shown, but say why not.
  const promptItems = useMemo(() => {
    const at = columns.findIndex((c) => c.id === col.id);
    return columns.filter((c) => c.id !== col.id).map((c) => {
      const idx = columns.findIndex((x) => x.id === c.id);
      const right = at >= 0 && idx > at;
      return {
        id: c.id, name: c.name, kind: c.type, section: right ? 'Fills after this column' : 'Columns',
        icon: TYPE_GLYPH[c.type] || 'Aa', description: TYPE_LABEL[c.type] || c.type,
        color: c.type === 'compute' ? '#7C3AED' : undefined,
        disabled: right ? 'to the right' : false,
      };
    });
  }, [columns, col.id]);

  const apply = () => {
    const patch = { type };
    // A value with a chosen color travels as {label, color}; the rest as labels.
    patch.options = values.map((v) => (v.color ? { label: v.label, color: v.color } : v.label));
    if (type === 'compute') {
      const compute = { kind, deps: [...deps] };
      if (kind === 'prompt') compute.prompt = prompt;
      if (kind === 'harness') { compute.harness_id = harnessId; compute.prompt = prompt; }
      if (kind === 'workflow') { compute.workflow_slug = wfSlug; compute.output_key = outKey; }
      patch.compute = compute;
    }
    onApply(patch);
  };

  return (
    <PopPortal anchor={anchor} width={250} estHeight={340} className="shg-menu" onClose={onClose}>
      <div ref={ref} onClick={(e) => e.stopPropagation()}>
      <label className="shg-menu-lbl">Type
        <select className="shg-menu-input" value={type} onChange={(e) => setType(e.target.value)}>
          {MANUAL_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          <option value="compute">Computed</option>
        </select>
      </label>

      <div className="shg-menu-lbl">{type === 'select' || type === 'tags' ? 'Options' : 'Values'}
        <ValuePills values={values} onChange={setValues} />
      </div>

      {type === 'compute' && (
        <>
          <label className="shg-menu-lbl">Runs
            <select className="shg-menu-input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {COMPUTE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          {(kind === 'prompt' || kind === 'harness') && (
            <div className="shg-menu-lbl">Prompt
              <div className="shg-menu-input shg-menu-prompt">
                <MentionInput
                  value={prompt}
                  onChange={(v, ms) => { setPrompt(v); setDeps(new Set(ms.map((m) => m.id))); }}
                  items={promptItems}
                  placeholder="Summarize @Company in one line"
                  menuTitle="Columns this cell can read"
                  emptyText="No column by that name"
                  label="Prompt"
                />
              </div>
              <div className="shg-menu-hint">Type @ to add a column from this row. Columns to the left fill first.</div>
            </div>
          )}
          {kind === 'harness' && (
            <label className="shg-menu-lbl">Agent id
              <input className="shg-menu-input" value={harnessId} onChange={(e) => setHarnessId(e.target.value)} placeholder="chrn_…" />
            </label>
          )}
          {kind === 'workflow' && (
            <>
              <label className="shg-menu-lbl">Workflow id
                <input className="shg-menu-input" value={wfSlug} onChange={(e) => setWfSlug(e.target.value)} placeholder="my-workflow" />
              </label>
              <label className="shg-menu-lbl">Output key (optional)
                <input className="shg-menu-input" value={outKey} onChange={(e) => setOutKey(e.target.value)} placeholder="summary" />
              </label>
            </>
          )}
        </>
      )}

      <div className="shg-menu-actions">
        <button className="shg-menu-del" onClick={onDelete}>Delete column</button>
        <button className="shg-menu-apply" onClick={apply}>Apply</button>
      </div>
      </div>
    </PopPortal>
  );
}

// ── Export helpers (CSV / TSV / array-of-arrays) ─────────────────────────────
export function sheetToDelimited(sheet, sep = ',') {
  const cols = sheet?.columns || [];
  const rows = sheet?.rows || [];
  const cells = sheet?.cells || {};
  const esc = (v) => {
    const s = v == null ? '' : (Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    if (sep === ',' && /[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = cols.map((c) => esc(c.name)).join(sep);
  const body = rows.map((r) => cols.map((c) => {
    const cell = cells[cellKey(r.id, c.id)];
    return esc(cell ? cell.value : '');
  }).join(sep));
  return [header, ...body].join('\n');
}

/** Rows as an array-of-arrays (header first) — feed to an xlsx writer. */
export function sheetToAoA(sheet) {
  const cols = sheet?.columns || [];
  const rows = sheet?.rows || [];
  const cells = sheet?.cells || {};
  const val = (v) => (v == null ? '' : (Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : v)));
  return [cols.map((c) => c.name),
          ...rows.map((r) => cols.map((c) => val(cells[cellKey(r.id, c.id)]?.value)))];
}
