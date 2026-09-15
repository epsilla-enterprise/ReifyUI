// LogsPane — the graph's activity trail (the Logs tab). Every operation on the
// graph (copilot tool calls, canvas/inspector edits, schema saves, lifecycle)
// is one row, newest first. Pagination AND search are server-side: the list
// only ever holds the pages the user actually walked, and typing in the search
// box re-queries the store (debounced), never filters a local copy.
//
// Design language lifted from the HarnessRouter Traces list (row grid, kind
// badges, mono stats column, expandable detail, skeleton loading) and restyled
// with the ContextualGraph tokens. JSON detail renders through the shared
// UI Core CodeBlock.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, KeyRound, ScrollText, Search, X } from 'lucide-react';
import { CodeBlock } from '../components/CodeBlock.jsx';
import { fmtUnits, relativeTime } from './format.js';
import { Skeleton } from './Skeleton.jsx';

const PAGE = 25;

// op -> short display label, always the user's vocabulary.
const OP_LABEL = {
  get_schema: 'Read design',
  add_vertex_type: 'Add node type',
  add_node_type: 'Add node type',
  update_node_type: 'Update node type',
  delete_vertex_type: 'Delete node type',
  delete_node_type: 'Delete node type',
  add_edge_type: 'Add relationship',
  add_relationship_type: 'Add relationship',
  update_relationship_type: 'Update relationship',
  delete_edge_type: 'Delete relationship',
  delete_relationship_type: 'Delete relationship',
  add_property: 'Add field',
  add_field: 'Add field',
  update_field: 'Update field',
  rename_property: 'Rename field',
  rename_field: 'Rename field',
  delete_property: 'Delete field',
  delete_field: 'Delete field',
  add_semantic_index: 'Add search index',
  add_search_index: 'Add search index',
  delete_search_index: 'Delete search index',
  add_connection: 'Add connection',
  delete_connection: 'Delete connection',
  update_ui: 'Update style',
  update_style: 'Update style',
  batch_schema: 'Schema changes',
  schema_batch: 'Schema changes',
  schema_change: 'Schema change',
  get_schema_job: 'Check change',
  save_design: 'Save design',
  query: 'Query',
  semantic_search: 'Search',
  upsert_vertex: 'Save record',
  add_record: 'Add record',
  delete_vertex: 'Delete record',
  upsert_edge: 'Link records',
  link_records: 'Link records',
  delete_edge: 'Unlink records',
  edit_records: 'Edit records',
  copilot_turn: 'Chat',
  create_graph: 'Create graph',
  rename_graph: 'Rename graph',
  delete_graph: 'Delete graph',
  update_thumbnail: 'Preview image',
  // Connect: tool registry, API keys, external agent calls
  connect_list_tools: 'Read tools',
  connect_save_tool: 'Save tool',
  connect_delete_tool: 'Delete tool',
  connect_set_enabled: 'Toggle tool',
  connect_test_tool: 'Test tool',
  connect_list_keys: 'Read API keys',
  create_key: 'Create API key',
  create_api_key: 'Create API key',
  delete_key: 'Revoke API key',
  delete_api_key: 'Revoke API key',
  revoke_key: 'Revoke API key',
  external_call: 'Agent call',
  mcp_call: 'Agent call',
  tool_call: 'Agent call',
};
const opLabel = (op) =>
  OP_LABEL[op] || String(op || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Connect ops whose family the prefix rules below would misread
// (connect_delete_tool starts with "connect", not "delete"; an external
// agent call is its own family with its own tint).
const OP_KIND = {
  connect_save_tool: 'add',
  connect_delete_tool: 'del',
  connect_set_enabled: 'edit',
  connect_test_tool: 'read',
  connect_list_tools: 'read',
  connect_list_keys: 'read',
  external_call: 'ext',
  mcp_call: 'ext',
  tool_call: 'ext',
};

// badge tint by operation family (mirrors the Traces kind palette, CG tones)
function opKind(op = '', status = '') {
  if (status === 'error') return 'err';
  if (OP_KIND[op]) return OP_KIND[op];
  if (op === 'copilot_turn') return 'chat';
  if (/^(delete|drop|unlink)/.test(op)) return 'del';
  if (/^(add|create|link|upsert|save)/.test(op)) return 'add';
  if (/^(query|semantic_search|get|read|check)/.test(op)) return 'read';
  return 'edit';
}

const fmtDur = (ms) => {
  if (ms == null) return '';
  const n = Number(ms);
  if (!isFinite(n)) return '';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`;
};

function ActorChip({ actor, copilotMark }) {
  const copilot = actor?.kind === 'copilot';
  // An external agent call is attributed to the API key it presented —
  // a distinct chip so third-party access reads differently from people.
  if (actor?.kind === 'api_key' || actor?.type === 'api_key') {
    const keyName = actor.name || 'API key';
    return (
      <span className="lg-actor lg-actor-key" title={`API key: ${keyName}`}>
        <KeyRound size={11} aria-hidden="true" />
        <span className="lg-actor-name">{keyName}</span>
      </span>
    );
  }
  const name = copilot ? 'Copilot' : (actor?.name || 'Someone');
  return (
    <span className="lg-actor" title={name}>
      {copilot
        ? <span className="lg-actor-mark">{copilotMark ?? <Bot size={14} />}</span>
        : <span className="lg-actor-av">{(name[0] || '?').toUpperCase()}</span>}
      <span className="lg-actor-name">{name}</span>
    </span>
  );
}

function DetailBlock({ entry }) {
  const when = entry.ts ? new Date(entry.ts).toLocaleString() : '';
  const hasArgs = entry.args != null &&
    !(typeof entry.args === 'object' && Object.keys(entry.args).length === 0);
  let argsText = '';
  if (hasArgs) {
    try { argsText = JSON.stringify(entry.args, null, 2); } catch { argsText = String(entry.args); }
  }
  // Consumption envelope from the execution response: real units only,
  // spelled out ("12.4 read units"), nothing shown when the entry has none.
  const units = fmtUnits(entry.consumption);
  return (
    <div className="lg-detail">
      <div className="lg-detail-meta mono">
        {when}
        {entry.duration_ms != null && <span> · {fmtDur(entry.duration_ms)}</span>}
        {units && <span> · {units}</span>}
      </div>
      {entry.error && <div className="lg-detail-err">{entry.error}</div>}
      {hasArgs
        ? <CodeBlock code={argsText} language="json" className="lg-json" />
        : (!entry.error && <div className="lg-detail-none">No further detail for this action.</div>)}
    </div>
  );
}

function Row({ entry, open, onToggle }) {
  const kind = opKind(entry.op, entry.status);
  return (
    <div className={'lg-row-wrap' + (open ? ' open' : '')}>
      <button type="button" className="lg-row" onClick={onToggle} aria-expanded={open}>
        <span className="lg-caret">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className={`lg-dot lg-${entry.status === 'error' ? 'error' : 'ok'}`} aria-hidden="true" />
        <span className={`lg-badge lg-k-${kind}`}>{opLabel(entry.op)}</span>
        <span className="lg-sum">{entry.summary || opLabel(entry.op)}</span>
        <span className="lg-side">
          <ActorChip actor={entry.actor} copilotMark={copilotMark} />
          {entry.duration_ms != null && <span className="lg-dur mono">{fmtDur(entry.duration_ms)}</span>}
          <span className="lg-ago mono">{relativeTime(Date.parse(entry.ts)) || ''}</span>
        </span>
      </button>
      {open && <DetailBlock entry={entry} />}
    </div>
  );
}

function LogsSkeleton() {
  return (
    <div className="lg-list" aria-busy="true" aria-label="Loading activity">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="lg-skel-row">
          <Skeleton w={8} h={8} radius={999} />
          <Skeleton w={86} h={18} radius={999} />
          <Skeleton w={`${34 + ((i * 13) % 40)}%`} h={12} />
          <span className="lg-skel-right"><Skeleton w={90} h={12} /></span>
        </div>
      ))}
    </div>
  );
}

/** `client`: {fetchAudit(graphId, {limit, cursor, q})} bound to the host's API and auth. */
export function LogsPane({ graphId, client, copilotMark }) {
  const [entries, setEntries] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);       // first page for the current q
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const genRef = useRef(0);                           // drop stale responses

  // Debounce the search box into the server-side q (fresh first page each time).
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const loadFirst = useCallback(async () => {
    const gen = ++genRef.current;
    setLoading(true); setError('');
    try {
      const body = await client.fetchAudit(graphId, { limit: PAGE, q });
      if (genRef.current !== gen) return;
      setEntries(body.entries || []);
      setNextCursor(body.next_cursor || null);
      setOpen(new Set());
    } catch (e) {
      if (genRef.current !== gen) return;
      // The raw error goes to the console for debugging; the user gets a
      // friendly line plus a Try again control, never server detail.
      console.warn('Activity load failed:', e);
      setEntries([]); setNextCursor(null);
      setError(true);
    } finally {
      if (genRef.current === gen) setLoading(false);
    }
  }, [graphId, q, client]);

  useEffect(() => { loadFirst(); }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const gen = genRef.current;
    setLoadingMore(true);
    try {
      const body = await client.fetchAudit(graphId, { limit: PAGE, cursor: nextCursor, q });
      if (genRef.current !== gen) return;
      setEntries((prev) => [...prev, ...(body.entries || [])]);
      setNextCursor(body.next_cursor || null);
    } catch (e) {
      // Keep the already-loaded rows on screen; the Load more button stays
      // for another attempt. Raw error to the console only.
      if (genRef.current === gen) console.warn('Activity load-more failed:', e);
    } finally {
      if (genRef.current === gen) setLoadingMore(false);
    }
  }, [graphId, nextCursor, loadingMore, q, client]);

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const empty = !loading && !error && entries.length === 0;

  return (
    <div className="gp-placeholder lg-root">
      <div className="pane" style={{ flex: 1 }}>
        <div className="lg-head">
          <div className="lg-title">Logs</div>
          <div className="lg-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search activity"
              aria-label="Search activity"
            />
            {qInput && (
              <button type="button" className="lg-search-x" onClick={() => setQInput('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <LogsSkeleton />
        ) : error ? (
          <div className="pane-empty">
            <div className="big">Could not load activity</div>
            <div>Please try again.</div>
            <button type="button" className="btn sm" onClick={loadFirst}>Try again</button>
          </div>
        ) : empty ? (
          <div className="pane-empty">
            <ScrollText size={28} />
            <div className="big">{q ? 'No matching activity' : 'No activity yet'}</div>
            <div style={{ maxWidth: 420 }}>
              {q ? 'Nothing in this graph’s history matches your search.'
                 : 'Actions on this graph will appear here.'}
            </div>
          </div>
        ) : (
          <>
            <div className="lg-list scroll">
              {entries.map((e) => (
                <Row key={e.id} entry={e} open={open.has(e.id)} onToggle={() => toggle(e.id)} />
              ))}
              {nextCursor && (
                <div className="lg-more">
                  <button type="button" className="btn sm" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
