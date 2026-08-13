// SheetGrid — the reusable AI-spreadsheet grid.
//
// Product-agnostic: it renders a sheet JSON and calls back for edits/runs. All I/O is injected —
// this file has no product API.
//
// Sheet shape:
//   { meta{title}, columns[{id,name,type,options?,width?}],
//     rows[{id,height?}], cells{ "<rowId>:<colId>": {value,…} } }
//
// Props:
//   sheet       — the sheet JSON (required)
//   onChange(next)          — persist an edited sheet (add/edit/delete col/row/cell)
//   onRunCell(rowId, colId) — run one computed cell (optional)
//   onRunColumn(colId)      — batch-run a computed column (optional)
//   readOnly    — no editing/running (template previews / embedded read views)
//   fetchBlobUrl(path)      — async product-authed fetch -> object URL, for inline images
//                             whose url is a product path
//   onOpenResource(ref)     — open a referenced artifact (sheet/slides/…)
//   columnTypes             — the column vocabulary (see SheetColumnType below). Defaults to
//                             this file's own set, so existing hosts need not pass it.
//   renderCell(ctx)         — replace a cell's body. Return undefined to fall through.
//   renderColumnConfig(ctx) — replace the column popover's body. Return undefined to fall through.
//
// Editing is optimistic: local edits call onChange with the next sheet; the host persists and
// hands truth back through `sheet`.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const cellKey = (rowId, colId) => `${rowId}:${colId}`;
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

// A column type is a descriptor, not a hardcoded literal. This grid used to test
// `col.type === 'compute'` in twelve places, which meant a host could not add a column kind
// without forking the file — and a fork is how two copies of one component start.
//
//   type       the value stored in column.type
//   label      what the type menu and the header sub-label show
//   computed   the app fills these cells, not the person: status dot, tint, run affordances
//   editable   defaults to !computed
//   configKey  the column's config object for this type; dropped when the type changes
//   badge(col) an extra header sub-label, e.g. which kind of compute this is
const DEFAULT_COLUMN_TYPES = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'select', label: 'Select' },
  { type: 'tags', label: 'Tags' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'date', label: 'Date' },
  { type: 'url', label: 'Link' },
  { type: 'resource', label: 'Resource' },
  {
    type: 'compute',
    label: 'Computed',
    computed: true,
    configKey: 'compute',
    badge: (col) => col.compute?.kind,
  },
];

const COMPUTE_KINDS = [
  { kind: 'prompt', label: 'AI prompt' },
  { kind: 'harness', label: 'Agent (harness)' },
  { kind: 'workflow', label: 'Workflow' },
  { kind: 'image', label: 'Generate image' },
];
const RESOURCE_KINDS = ['image', 'sheet', 'slides', 'workflow', 'graph'];
const RESOURCE_ICON = { image: '🖼', sheet: '▦', slides: '▤', workflow: '⚙', graph: '◉' };

// Popovers render through a body portal with FIXED positioning — inside the grid they'd be
// clipped by the scroll container and out-stacked by the sticky header/row-number cells. anchor
// is a DOMRect captured at open time; the box clamps to the viewport and flips above the anchor
// when the bottom would overflow. Any scroll closes it (the anchor moved).
function PopPortal({ anchor, width = 250, estHeight = 300, className, children, onClose }) {
  const boxRef = useRef(null);
  useEffect(() => {
    if (!onClose) return undefined;
    const close = () => onClose();
    // mousedown, not click: React 18 flushes a listener attached in this effect synchronously
    // during the very discrete event that opened the popover, so a `click` listener closes the
    // box before it paints. A press inside the anchor is also ignored — that is the trigger's
    // own toggle, and closing here would race it into staying open.
    const onDown = (e) => {
      if (boxRef.current && boxRef.current.contains(e.target)) return;
      if (anchor && e.clientX >= anchor.left && e.clientX <= anchor.right
          && e.clientY >= anchor.top && e.clientY <= anchor.bottom) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onClose, anchor]);
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

// A muted rotation for select/tag pills when an option declares no color.
const PILL_FALLBACKS = ['#E0E7FF', '#FCE7F3', '#D1FAE5', '#FEF3C7', '#E0F2FE', '#F3E8FF', '#FFE4E6'];

function normOptions(options) {
  return (options || []).map((o, i) => {
    if (typeof o === 'string') return { label: o, color: PILL_FALLBACKS[i % PILL_FALLBACKS.length] };
    return { label: o.label ?? String(o.value ?? ''), color: o.color || PILL_FALLBACKS[i % PILL_FALLBACKS.length] };
  });
}

function pillColor(label, options) {
  const opts = normOptions(options);
  const hit = opts.find((o) => o.label === label);
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

// A small status dot for computed cells.
function StatusDot({ status }) {
  if (!status || status === 'empty') return null;
  return <span className={`shg-dot shg-dot-${status}`} title={status} />;
}

function CellValue({ cell, col, fetchBlobUrl, onOpenResource }) {
  const v = cell?.value;
  if (v === undefined || v === null || v === '') return <span className="shg-val-txt" />;
  // A typed artifact ref renders the same whether hand-set (resource column) or produced by a
  // compute kind (e.g. Generate image).
  if (v && typeof v === 'object' && !Array.isArray(v) && v.kind) {
    if (v.kind === 'image') return <RefImage refVal={v} fetchBlobUrl={fetchBlobUrl} />;
    return <ResourceChip refVal={v} onOpen={onOpenResource} />;
  }
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

export function SheetGrid({
  sheet, onChange, onRunCell, onRunColumn, readOnly = false, fetchBlobUrl, onOpenResource,
  peerMarks, onActiveCell, columnTypes = DEFAULT_COLUMN_TYPES, renderCell, renderColumnConfig,
}) {
  const columns = sheet?.columns || [];
  const rows = sheet?.rows || [];
  const cells = sheet?.cells || {};
  const [editing, setEditing] = useState(null);   // {rowId, colId, type}
  const [draft, setDraft] = useState('');
  const [menuCol, setMenuCol] = useState(null);   // {id, rect} of the open column menu
  const [sizeDraft, setSizeDraft] = useState({}); // live {col:{id:w}, row:{id:h}} during a drag
  const [dnd, setDnd] = useState(null);           // {kind:'col'|'row', id} being dragged
  const [dropAt, setDropAt] = useState(null);     // {kind, id, after} current drop slot
  const inputRef = useRef(null);
  const dragRef = useRef(null);

  // An unknown type still renders — as plain text, editable. Refusing to draw a column because
  // its type is unfamiliar would hide the person's data from them.
  const descOf = (type) => columnTypes.find((t) => t.type === type) || { type, label: type };
  const isComputed = (col) => !!descOf(col?.type).computed;
  const isEditable = (col) => {
    const d = descOf(col?.type);
    return d.editable ?? !d.computed;
  };

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
      mutate((n) => {
        if (d.kind === 'col') { const c = n.columns.find((x) => x.id === d.id); if (c) c.width = Math.round(d.last); }
        else { const r = n.rows.find((x) => x.id === d.id); if (r) r.height = Math.round(d.last); }
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = kind === 'col' ? 'col-resize' : 'row-resize';
  };
  const colWidth = (col) => (sizeDraft.col && sizeDraft.col[col.id]) || col.width || undefined;

  // Drag-to-reorder (columns by their header, rows by their number cell).
  const reorder = (kind, fromId, toId, after) => mutate((n) => {
    const arr = kind === 'col' ? n.columns : n.rows;
    const i = arr.findIndex((x) => x.id === fromId);
    if (i < 0 || fromId === toId) return;
    const [item] = arr.splice(i, 1);
    let j = arr.findIndex((x) => x.id === toId);
    if (j < 0) { arr.splice(i, 0, item); return; }
    if (after) j += 1;
    arr.splice(j, 0, item);
  });
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
  // The number gutter is FIXED: sized by the digit count of the row total so it never stretches
  // (an empty grid otherwise splits the table width).
  const numW = Math.max(40, 24 + String(rows.length || 1).length * 9);
  const numStyle = { width: numW, minWidth: numW, maxWidth: numW };
  const rowHeight = (row) => (sizeDraft.row && sizeDraft.row[row.id]) || row.height || undefined;

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const mutate = (fn) => {
    if (readOnly || !onChange) return;
    const next = JSON.parse(JSON.stringify(sheet));
    fn(next);
    onChange(next);
  };

  // A manual edit writes the value and nothing else. It used to stamp `status:'done'`, which
  // made every hand-typed cell claim to be the output of a run that never happened — and forced
  // status rendering to be gated on the column type rather than on the cell. On a computed
  // column the surrounding run record is kept, because there an override sits on top of a real
  // run and the link to that run is still true.
  const setCell = (rowId, colId, value) => mutate((n) => {
    n.cells = n.cells || {};
    const k = cellKey(rowId, colId);
    const col = (n.columns || []).find((c) => c.id === colId);
    const prev = n.cells[k];
    n.cells[k] = isComputed(col) && prev ? { ...prev, value } : { value };
  });

  const openEdit = (rowId, col, anchorEl) => {
    if (readOnly) return;
    if (!isEditable(col)) return;
    if (col.type === 'checkbox') {        // click toggles directly
      const cur = cells[cellKey(rowId, col.id)];
      setCell(rowId, col.id, !(cur && cur.value));
      return;
    }
    const c = cells[cellKey(rowId, col.id)];
    const v = c?.value;
    if (col.type === 'tags') setDraft(Array.isArray(v) ? v.join(', ') : (v || ''));
    else if (col.type === 'resource') setDraft(v && typeof v === 'object' ? v : { kind: 'sheet', name: '', id: '', url: '' });
    else setDraft(v == null ? '' : String(v));
    setEditing({ rowId, colId: col.id, type: col.type, rect: anchorEl?.getBoundingClientRect?.() || null });
    onActiveCell && onActiveCell(cellKey(rowId, col.id));
  };

  const commitEdit = () => {
    onActiveCell && onActiveCell(null);
    if (!editing) return;
    const { rowId, colId, type } = editing;
    let value = draft;
    if (type === 'number') value = draft === '' ? null : Number(draft);
    else if (type === 'tags') value = draft ? draft.split(',').map((s) => s.trim()).filter(Boolean) : [];
    setCell(rowId, colId, value);
    setEditing(null);
  };

  const addColumn = () => mutate((n) => {
    n.columns.push({ id: uid('col'), name: `Column ${n.columns.length + 1}`, type: 'text' });
  });
  const addRow = () => mutate((n) => { n.rows.push({ id: uid('row') }); });
  const deleteColumn = (colId) => mutate((n) => {
    n.columns = n.columns.filter((c) => c.id !== colId);
    for (const k of Object.keys(n.cells || {})) if (k.endsWith(`:${colId}`)) delete n.cells[k];
  });
  const deleteRow = (rowId) => mutate((n) => {
    n.rows = n.rows.filter((r) => r.id !== rowId);
    for (const k of Object.keys(n.cells || {})) if (k.startsWith(`${rowId}:`)) delete n.cells[k];
  });
  const renameColumn = (colId, name) => mutate((n) => {
    const c = n.columns.find((x) => x.id === colId); if (c) c.name = name;
  });
  const configureColumn = (colId, patch) => mutate((n) => {
    const c = n.columns.find((x) => x.id === colId); if (!c) return;
    Object.assign(c, patch);
    // A column carries the config of its own type and no other. Changing the type takes the old
    // config with it, so a harness column that becomes a text column stops carrying a prompt.
    if (patch.type) {
      for (const d of columnTypes) if (d.configKey && d.type !== patch.type) delete c[d.configKey];
    }
  });

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
             onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }} />
    );
  };

  return (
    <div className="shg">
      <div className="shg-scroll">
        <table className="shg-table">
          <thead>
            <tr>
              <th className="shg-corner" style={numStyle} />
              {columns.map((col) => (
                <th key={col.id}
                    className={'shg-col' + (isComputed(col) ? ' shg-col-compute' : '') + dndClass('col', col.id)}
                    style={colWidth(col) ? { width: colWidth(col), minWidth: colWidth(col), maxWidth: colWidth(col) } : undefined}
                    {...dndProps('col', col.id)}>
                  {!readOnly && (
                    <span className="shg-resize-col" onMouseDown={(e) => startResize(e, 'col', col.id, colWidth(col) || e.currentTarget.closest('th').offsetWidth)} />
                  )}
                  <div className="shg-col-h">
                    <ColumnHeader
                      col={col} columns={columns} readOnly={readOnly}
                      desc={descOf(col.type)} columnTypes={columnTypes}
                      renderColumnConfig={renderColumnConfig}
                      menuOpen={menuCol?.id === col.id}
                      menuAnchor={menuCol?.id === col.id ? menuCol.rect : null}
                      onMenu={(e) => setMenuCol(menuCol?.id === col.id ? null
                        : { id: col.id, rect: e.currentTarget.getBoundingClientRect() })}
                      onCloseMenu={() => setMenuCol(null)}
                      onRename={renameColumn}
                      onConfigure={configureColumn}
                      onDelete={() => { setMenuCol(null); deleteColumn(col.id); }}
                      onRun={isComputed(col) && onRunColumn ? () => onRunColumn(col.id) : null} />
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
                {columns.map((col) => {
                  const c = cells[cellKey(row.id, col.id)] || {};
                  const computed = isComputed(col);
                  const isEditing = editing && editing.rowId === row.id && editing.colId === col.id;
                  const peer = peerMarks && peerMarks[cellKey(row.id, col.id)];
                  // A host owns the whole cell body when it wants to: a running cell's live text
                  // lives in the host's run store, not in the sheet JSON, so only a closure can
                  // reach it. Returning undefined falls through to the built-in rendering.
                  const custom = renderCell && renderCell({
                    cell: c, column: col, row, rowIndex: ri, sheet, computed,
                    width: colWidth(col), height: rowHeight(row), editing: !!isEditing, readOnly,
                    setCell: (v) => setCell(row.id, col.id, v),
                    runCell: onRunCell && !readOnly ? () => onRunCell(row.id, col.id) : null,
                  });
                  return (
                    <td key={col.id}
                        className={'shg-cell' + (computed ? ' shg-cell-compute' : '')
                                   + (c.status && computed ? ` shg-cell-${c.status}` : '')
                                   + (peer ? ' shg-cell-peer' : '')}
                        style={peer ? { boxShadow: `inset 0 0 0 2px ${peer.color}` } : undefined}
                        onClick={(e) => { if (!isEditing) openEdit(row.id, col, e.currentTarget); }}
                        title={c.error || ''}>
                      {peer && <span className="shg-peer-flag" style={{ background: peer.color }}>{peer.name}</span>}
                      {isEditing ? renderEditor(col) : (
                        <div className="shg-val"
                             style={{ maxWidth: (colWidth(col) ? colWidth(col) - 20 : 400) }}>
                          {custom !== undefined ? custom : (
                            <>
                              {computed && <StatusDot status={c.status} />}
                              <CellValue cell={c} col={col} fetchBlobUrl={fetchBlobUrl} onOpenResource={onOpenResource} />
                              {computed && !readOnly && onRunCell && (
                                <button className="shg-runcell" title="Run this cell"
                                        onClick={(e) => { e.stopPropagation(); onRunCell(row.id, col.id); }}>▶</button>
                              )}
                            </>
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

function ColumnHeader({
  col, columns, readOnly, desc, columnTypes, renderColumnConfig,
  menuOpen, menuAnchor, onMenu, onCloseMenu, onRename, onConfigure, onDelete, onRun,
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(col.name);
  useEffect(() => setName(col.name), [col.name]);
  const badge = desc.badge ? desc.badge(col) : undefined;
  return (
    <div className="shg-colhdr">
      <div className="shg-colhdr-main">
        {editing && !readOnly ? (
          <input className="shg-colname-input" value={name} autoFocus
                 onChange={(e) => setName(e.target.value)}
                 onBlur={() => { setEditing(false); if (name.trim() && name !== col.name) onRename(col.id, name.trim()); }}
                 onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
        ) : (
          <span className="shg-colname" onDoubleClick={() => !readOnly && setEditing(true)} title={col.name}>{col.name}</span>
        )}
        <span className={'shg-coltype' + (desc.computed ? ' compute' : '')}>
          {desc.label || col.type}
          {badge ? ` · ${badge}` : ''}
        </span>
      </div>
      {!readOnly && (
        <div className="shg-colhdr-tools">
          {onRun && <button className="shg-colrun" onClick={onRun} title="Run this column">▶ Run</button>}
          <button className="shg-colmenu-btn" onClick={(e) => onMenu(e)} title="Column settings">⋯</button>
        </div>
      )}
      {menuOpen && !readOnly && (
        <ColumnMenu col={col} columns={columns} anchor={menuAnchor}
                    columnTypes={columnTypes} renderColumnConfig={renderColumnConfig}
                    onApply={(patch) => { onConfigure(col.id, patch); onCloseMenu(); }}
                    onDelete={onDelete} onClose={onCloseMenu} />
      )}
    </div>
  );
}

// The column configuration popover: type, options (select/tags), and the type's own config body.
// Product-agnostic — plain controlled inputs, applied as one patch. A host that adds a column
// type supplies renderColumnConfig and owns the body below the Type select.
function ColumnMenu({ col, columns, anchor, columnTypes, renderColumnConfig, onApply, onDelete, onClose }) {
  const [type, setType] = useState(col.type || 'text');
  const [optText, setOptText] = useState(
    normOptions(col.options).map((o) => o.label).join('\n'));
  const comp = col.compute || {};
  const [kind, setKind] = useState(comp.kind || 'prompt');
  const [prompt, setPrompt] = useState(comp.prompt || '');
  const [harnessId, setHarnessId] = useState(comp.harness_id || '');
  const [wfSlug, setWfSlug] = useState(comp.workflow_slug || '');
  const [outKey, setOutKey] = useState(comp.output_key || '');
  const [deps, setDeps] = useState(new Set(comp.deps || []));

  const others = columns.filter((c) => c.id !== col.id);
  const toggleDep = (id) => setDeps((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const apply = () => {
    const patch = { type };
    if (type === 'select' || type === 'tags') {
      patch.options = optText.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    // The built-in 'compute' type's own editor. Any other type's config comes from the host.
    if (type === 'compute') {
      const compute = { kind, deps: [...deps] };
      if (kind === 'prompt') compute.prompt = prompt;
      if (kind === 'harness') { compute.harness_id = harnessId; compute.prompt = prompt; }
      if (kind === 'workflow') { compute.workflow_slug = wfSlug; compute.output_key = outKey; }
      patch.compute = compute;
    }
    onApply(patch);
  };

  // A custom body owns its own primary action, because only it knows when its config is
  // complete. It gets applyPatch to commit and close in one call.
  const custom = renderColumnConfig && renderColumnConfig({
    column: col, columns, type,
    applyPatch: (patch) => onApply({ type, ...patch }),
    deleteColumn: onDelete,
    close: onClose,
  });

  return (
    <PopPortal anchor={anchor} width={250} estHeight={340} className="shg-menu" onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
      <label className="shg-menu-lbl">Type
        <select className="shg-menu-input" value={type} onChange={(e) => setType(e.target.value)}>
          {columnTypes.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
      </label>

      {(type === 'select' || type === 'tags') && (
        <label className="shg-menu-lbl">Options (one per line)
          <textarea className="shg-menu-input" rows={3} value={optText}
                    onChange={(e) => setOptText(e.target.value)} placeholder={'Todo\nDoing\nDone'} />
        </label>
      )}

      {custom !== undefined ? custom : (
        <>
          {type === 'compute' && (
            <>
              <label className="shg-menu-lbl">Runs
                <select className="shg-menu-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {COMPUTE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
              </label>
              {(kind === 'prompt' || kind === 'harness') && (
                <label className="shg-menu-lbl">Prompt — reference columns as {'{{Name}}'}
                  <textarea className="shg-menu-input" rows={3} value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Summarize {{Company}} in one line" />
                </label>
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
              {others.length > 0 && (
                <div className="shg-menu-lbl">Reads columns
                  <div className="shg-menu-deps">
                    {others.map((c) => (
                      <label key={c.id} className="shg-menu-dep">
                        <input type="checkbox" checked={deps.has(c.id)} onChange={() => toggleDep(c.id)} /> {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <div className="shg-menu-actions">
            <button className="shg-menu-del" onClick={onDelete}>Delete column</button>
            <button className="shg-menu-apply" onClick={apply}>Apply</button>
          </div>
        </>
      )}
      </div>
    </PopPortal>
  );
}

// ── Export helpers (CSV / TSV / array-of-arrays) ─────────────────────────────
// cellText(cell, column) lets a host say what one of its own column types is worth in a flat
// file. Without it a cell whose value is an object exports as raw JSON, which is what a
// spreadsheet export must never be.
function defaultCellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function sheetToDelimited(sheet, sep = ',', { cellText = defaultCellText } = {}) {
  const cols = sheet?.columns || [];
  const rows = sheet?.rows || [];
  const cells = sheet?.cells || {};
  const esc = (s) => {
    if (sep === ',' && /[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = cols.map((c) => esc(c.name)).join(sep);
  const body = rows.map((r) => cols.map((c) => (
    esc(String(cellText(cells[cellKey(r.id, c.id)], c) ?? ''))
  )).join(sep));
  return [header, ...body].join('\n');
}

/** Rows as an array-of-arrays (header first) — feed to an xlsx writer.
 *
 *  The default keeps numbers and booleans as themselves: a spreadsheet writer stores a JS number
 *  as a numeric cell, and stringifying here would hand the person a column they cannot sum. */
function defaultCellValue(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function sheetToAoA(sheet, { cellText = defaultCellValue } = {}) {
  const cols = sheet?.columns || [];
  const rows = sheet?.rows || [];
  const cells = sheet?.cells || {};
  return [cols.map((c) => c.name),
          ...rows.map((r) => cols.map((c) => cellText(cells[cellKey(r.id, c.id)], c) ?? ''))];
}
