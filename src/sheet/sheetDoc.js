// sheetDoc — the Sheet document family ("cg-sheet:<sheetId>"), ONE module
// for the collab sidecar (backend/company_brain, which imports it by relative
// path) and the browsers (ui-core). It takes no dependency of its own: the
// functions work on Yjs shared types the caller hands in, so the same code
// runs wherever a Y.Doc exists.
//
// The Yjs document IS the sheet while people edit it; the Sheets service's
// JSON (sheets/<id>/sheet.json) is its materialization, written through the
// store hook the way brain docs materialize markdown. Every writer, browser
// grid, copilot tool or batch run, changes the document: browsers through
// Yjs transactions, services through ops on /v1/cg/publish. Reads that must
// be current (a run deciding a cell's dependencies) come from the document.
//
// Layout, all top-level shared types so a client subscribes to what it draws:
//   meta               Y.Map    service keys: title, run, copilot
//   taborder           Y.Array  tab ids in order
//   tabs               Y.Map    tabId -> {id, name}
//   cols:<tab>         Y.Map    colId -> column        colorder:<tab>  Y.Array colId
//   rows:<tab>         Y.Map    rowId -> row           roworder:<tab>  Y.Array rowId
//   cells:<tab>        Y.Map    "rowId:colId" -> cell
// Maps hold the objects, arrays hold the order: two people inserting rows at
// once both land, and a cell edit touches one key. Order arrays are read
// through orderOf(), which drops ids no longer in the map and appends ids
// the map holds but the order lost, so a concurrent move and delete can
// never lose an item.
export const SHEET_PREFIX = 'cg-sheet:';
export const isSheetDoc = (name) => typeof name === 'string' && name.startsWith(SHEET_PREFIX);
export const sheetIdOf = (name) => name.slice(SHEET_PREFIX.length);

const map = (doc, name) => doc.getMap(name);
const arr = (doc, name) => doc.getArray(name);

/** Ids in array order, deduplicated, only those the map holds, plus the
 *  map's strays at the end (in insertion order). */
export function orderOf(order, m) {
  const seen = new Set();
  const out = [];
  for (const id of order.toArray()) {
    if (m.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  for (const id of m.keys()) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}

function clearMap(m) { for (const k of [...m.keys()]) m.delete(k); }
function clearArray(a) { if (a.length) a.delete(0, a.length); }
function removeFromOrder(order, id) {
  const items = order.toArray();
  for (let i = items.length - 1; i >= 0; i--) if (items[i] === id) order.delete(i, 1);
}
function placeInOrder(order, id, at) {
  removeFromOrder(order, id);
  const n = order.length;
  const i = Number.isInteger(at) ? Math.max(0, Math.min(at, n)) : n;
  order.insert(i, [id]);
}

function tabIds(doc) {
  return orderOf(arr(doc, 'taborder'), map(doc, 'tabs'));
}

function clearTab(doc, tabId) {
  clearMap(map(doc, `cols:${tabId}`)); clearArray(arr(doc, `colorder:${tabId}`));
  clearMap(map(doc, `rows:${tabId}`)); clearArray(arr(doc, `roworder:${tabId}`));
  clearMap(map(doc, `cells:${tabId}`));
}

function fillTab(doc, tab) {
  const cols = map(doc, `cols:${tab.id}`), colorder = arr(doc, `colorder:${tab.id}`);
  const rows = map(doc, `rows:${tab.id}`), roworder = arr(doc, `roworder:${tab.id}`);
  const cells = map(doc, `cells:${tab.id}`);
  for (const c of tab.columns || []) { cols.set(c.id, c); colorder.push([c.id]); }
  for (const r of tab.rows || []) { rows.set(r.id, r); roworder.push([r.id]); }
  for (const [k, v] of Object.entries(tab.cells || {})) if (v !== null && v !== undefined) cells.set(k, v);
}

/** Replace the document's content with a sheet JSON (fresh open, or an
 *  explicit replace). Runs inside one transaction. */
export function seed(doc, sheet, origin = 'seed') {
  doc.transact(() => {
    for (const id of tabIds(doc)) clearTab(doc, id);
    clearMap(map(doc, 'tabs')); clearArray(arr(doc, 'taborder'));
    const meta = map(doc, 'meta');
    meta.set('title', String((sheet.meta || {}).title || ''));
    for (const tab of sheet.tabs || []) {
      map(doc, 'tabs').set(tab.id, { id: tab.id, name: tab.name });
      arr(doc, 'taborder').push([tab.id]);
      fillTab(doc, tab);
    }
  }, origin);
}

/** The sheet JSON the document currently describes. */
export function toJSON(doc) {
  const meta = map(doc, 'meta');
  const tabs = tabIds(doc).map((id) => {
    const t = map(doc, 'tabs').get(id) || { id, name: 'Sheet' };
    const cols = map(doc, `cols:${id}`), rows = map(doc, `rows:${id}`), cells = map(doc, `cells:${id}`);
    const columns = orderOf(arr(doc, `colorder:${id}`), cols).map((cid) => cols.get(cid));
    const rowList = orderOf(arr(doc, `roworder:${id}`), rows).map((rid) => rows.get(rid));
    const present = new Set([...columns.map((c) => c.id)]);
    const rowSet = new Set(rowList.map((r) => r.id));
    const out = {};
    for (const [k, v] of cells.entries()) {
      const i = k.indexOf(':');
      if (i > 0 && rowSet.has(k.slice(0, i)) && present.has(k.slice(i + 1))) out[k] = v;
    }
    return { id, name: t.name, columns, rows: rowList, cells: out };
  });
  return { meta: { title: meta.get('title') || '' }, tabs };
}

/** Apply service ops in one transaction. Unknown ops throw; nothing is
 *  applied then. */
export function apply(doc, ops, origin = 'service') {
  if (!Array.isArray(ops)) throw new Error('ops must be a list');
  for (const op of ops) validateOp(op);
  doc.transact(() => {
    for (const op of ops) applyOne(doc, op);
  }, origin);
}

const OPS = new Set(['set_cell', 'set_cells', 'set_column', 'delete_column', 'move_column',
  'set_row', 'delete_row', 'move_row', 'set_tab', 'delete_tab', 'move_tab', 'set_meta', 'replace']);

function validateOp(op) {
  if (!op || typeof op !== 'object' || !OPS.has(op.op)) throw new Error(`unknown op ${op && op.op}`);
  const needTab = !['set_tab', 'delete_tab', 'move_tab', 'set_meta', 'replace'].includes(op.op);
  if (needTab && typeof op.tab !== 'string') throw new Error(`${op.op}: tab required`);
  if (op.op === 'set_cell' && typeof op.key !== 'string') throw new Error('set_cell: key required');
  if (op.op === 'set_cells' && (!op.cells || typeof op.cells !== 'object')) throw new Error('set_cells: cells required');
  if (op.op === 'set_column' && !(op.column && typeof op.column.id === 'string')) throw new Error('set_column: column.id required');
  if (op.op === 'set_row' && !(op.row && typeof op.row.id === 'string')) throw new Error('set_row: row.id required');
  if (op.op === 'set_tab' && !(op.tab && typeof op.tab.id === 'string')) throw new Error('set_tab: tab.id required');
  if ((op.op === 'delete_column' || op.op === 'move_column' || op.op === 'delete_row' || op.op === 'move_row'
       || op.op === 'delete_tab' || op.op === 'move_tab') && typeof op.id !== 'string') throw new Error(`${op.op}: id required`);
  if (op.op === 'set_meta' && typeof op.key !== 'string') throw new Error('set_meta: key required');
  if (op.op === 'replace' && !(op.sheet && typeof op.sheet === 'object')) throw new Error('replace: sheet required');
}

function applyOne(doc, op) {
  switch (op.op) {
    case 'set_cell': {
      const cells = map(doc, `cells:${op.tab}`);
      if (op.cell === null || op.cell === undefined) cells.delete(op.key); else cells.set(op.key, op.cell);
      return;
    }
    case 'set_cells': {
      const cells = map(doc, `cells:${op.tab}`);
      for (const [k, v] of Object.entries(op.cells)) { if (v === null || v === undefined) cells.delete(k); else cells.set(k, v); }
      return;
    }
    case 'set_column': {
      map(doc, `cols:${op.tab}`).set(op.column.id, op.column);
      const order = arr(doc, `colorder:${op.tab}`);
      if (Number.isInteger(op.at) || !order.toArray().includes(op.column.id)) placeInOrder(order, op.column.id, op.at);
      return;
    }
    case 'delete_column': {
      map(doc, `cols:${op.tab}`).delete(op.id);
      removeFromOrder(arr(doc, `colorder:${op.tab}`), op.id);
      const cells = map(doc, `cells:${op.tab}`);
      for (const k of [...cells.keys()]) if (k.endsWith(`:${op.id}`)) cells.delete(k);
      return;
    }
    case 'move_column': placeInOrder(arr(doc, `colorder:${op.tab}`), op.id, op.at); return;
    case 'set_row': {
      map(doc, `rows:${op.tab}`).set(op.row.id, op.row);
      const order = arr(doc, `roworder:${op.tab}`);
      if (Number.isInteger(op.at) || !order.toArray().includes(op.row.id)) placeInOrder(order, op.row.id, op.at);
      return;
    }
    case 'delete_row': {
      map(doc, `rows:${op.tab}`).delete(op.id);
      removeFromOrder(arr(doc, `roworder:${op.tab}`), op.id);
      const cells = map(doc, `cells:${op.tab}`);
      for (const k of [...cells.keys()]) if (k.startsWith(`${op.id}:`)) cells.delete(k);
      return;
    }
    case 'move_row': placeInOrder(arr(doc, `roworder:${op.tab}`), op.id, op.at); return;
    case 'set_tab': {
      const t = op.tab;
      map(doc, 'tabs').set(t.id, { id: t.id, name: String(t.name || 'Sheet') });
      const order = arr(doc, 'taborder');
      if (Number.isInteger(op.at) || !order.toArray().includes(t.id)) placeInOrder(order, t.id, op.at);
      return;
    }
    case 'delete_tab': {
      map(doc, 'tabs').delete(op.id);
      removeFromOrder(arr(doc, 'taborder'), op.id);
      clearTab(doc, op.id);
      return;
    }
    case 'move_tab': placeInOrder(arr(doc, 'taborder'), op.id, op.at); return;
    case 'set_meta': {
      const meta = map(doc, 'meta');
      if (op.value === null || op.value === undefined) meta.delete(op.key); else meta.set(op.key, op.value);
      return;
    }
    case 'replace': seed(doc, op.sheet, 'service'); return;
    default: throw new Error(`unknown op ${op.op}`);
  }
}
