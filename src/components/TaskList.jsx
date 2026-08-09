// TaskList — the master list beside an agent conversation: one row per run/session, with
// live status, text filter, status filter, cursor pagination on scroll, and optional delete.
//
// Transport-agnostic, like everything else here. The consumer supplies `fetchPage`, which
// returns `{ items, cursor }` for a given cursor ('' = first page). ReifyUI never decides how
// you authenticate or where your API lives; it only decides how the result looks and behaves.
//
// Pagination model: the FIRST page is refetched on `refreshNonce` so live runs stay current,
// while older pages accumulate in a tail. Merging de-duplicates by id, so a run that moves
// between pages while you scroll cannot appear twice.
//
// Slots:
//   header      node rendered above the filter row (e.g. a harness selector)
//   onNew       when provided, renders the "New task" action
//   onDelete    when provided, each row gets a delete affordance (confirm is the consumer's job
//               if it wants one — this only calls back)
//   renderMeta  (item) => node, replaces the default right-hand status/time cell
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STATUS_GROUPS = {
  all: () => true,
  working: (s) => ['running', 'starting', 'queued', 'in_progress'].includes(s),
  done: (s) => ['done', 'completed'].includes(s),
  failed: (s) => ['failed', 'cancelled', 'incomplete', 'error'].includes(s),
};

/** Coarse bucket for the status dot — keeps colour logic in one place. */
export function taskStatusGroup(status) {
  const s = String(status || '').toLowerCase();
  for (const k of ['working', 'done', 'failed']) if (STATUS_GROUPS[k](s)) return k;
  return 'idle';
}

function relTime(ts) {
  const n = Number(ts) || 0;
  if (!n) return '';
  // Accept seconds or milliseconds — callers differ and a 1000x error is a silent wrong label.
  const ms = n > 1e12 ? n : n * 1000;
  const d = Math.max(0, Date.now() - ms) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function TaskList({
  fetchPage,
  selected,
  onSelect,
  onNew,
  onDelete,
  header,
  renderMeta,
  refreshNonce = 0,
  emptyLabel = 'No tasks yet',
  newLabel = 'New task',
  idKey = 'id',
  titleKey = 'title',
  statusKey = 'status',
  timeKey = 'updated_at',
}) {
  const [head, setHead] = useState(null);      // null = loading, [] = loaded-empty
  const [tail, setTail] = useState([]);
  const [cursor, setCursor] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  // First page — refetched whenever the consumer bumps refreshNonce (poll, SSE, post-send).
  useEffect(() => {
    let ok = true;
    Promise.resolve(fetchPage(''))
      .then((r) => {
        if (!ok) return;
        setHead(Array.isArray(r?.items) ? r.items : []);
        setCursor(r?.cursor || '');
      })
      .catch(() => { if (ok) setHead((p) => p ?? []); });   // keep what we had; don't blank the list
    return () => { ok = false; };
  }, [fetchPage, refreshNonce]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    Promise.resolve(fetchPage(cursor))
      .then((r) => {
        if (!alive.current) return;
        if (Array.isArray(r?.items)) setTail((t) => [...t, ...r.items]);
        setCursor(r?.cursor || '');
      })
      .catch(() => { /* keep the cursor so the next scroll retries */ })
      .finally(() => { if (alive.current) setLoadingMore(false); });
  }, [cursor, loadingMore, fetchPage]);

  const items = useMemo(() => {
    const h = head || [];
    const seen = new Set(h.map((x) => x?.[idKey]));
    return [...h, ...tail.filter((t) => !seen.has(t?.[idKey]))];
  }, [head, tail, idKey]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pass = STATUS_GROUPS[statusFilter] || STATUS_GROUPS.all;
    return items.filter((it) => {
      if (!pass(String(it?.[statusKey] || '').toLowerCase())) return false;
      if (!needle) return true;
      return String(it?.[titleKey] || '').toLowerCase().includes(needle);
    });
  }, [items, q, statusFilter, statusKey, titleKey]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 140) loadMore();
  };

  return (
    <div className="rui-tasks">
      {header ? <div className="rui-tasks-header">{header}</div> : null}
      {onNew ? (
        <button type="button" className="rui-tasks-new" onClick={onNew}>+ {newLabel}</button>
      ) : null}

      <div className="rui-tasks-filters">
        <input
          className="rui-tasks-search"
          value={q}
          placeholder="Filter tasks…"
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter tasks"
        />
        <select
          className="rui-tasks-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All</option>
          <option value="working">Working</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="rui-tasks-list" onScroll={onScroll}>
        {head === null ? (
          <div className="rui-tasks-empty">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="rui-tasks-empty">{items.length ? 'No matching tasks' : emptyLabel}</div>
        ) : (
          shown.map((it) => {
            const id = it?.[idKey];
            const group = taskStatusGroup(it?.[statusKey]);
            return (
              <div
                key={id}
                className={`rui-task${id === selected ? ' is-selected' : ''}`}
                onClick={() => onSelect?.(id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(id); }}
              >
                <div className="rui-task-main">
                  <div className="rui-task-title">{it?.[titleKey] || 'Untitled task'}</div>
                  <div className="rui-task-meta">
                    {renderMeta ? renderMeta(it) : (
                      <>
                        <span className={`rui-task-dot is-${group}`} />
                        <span className="rui-task-status">{it?.[statusKey] || ''}</span>
                        {it?.[timeKey] ? <span className="rui-task-time">{relTime(it[timeKey])}</span> : null}
                      </>
                    )}
                  </div>
                </div>
                {onDelete ? (
                  <button
                    type="button"
                    className="rui-task-del"
                    aria-label="Delete task"
                    onClick={(e) => { e.stopPropagation(); onDelete(it); }}
                  >×</button>
                ) : null}
              </div>
            );
          })
        )}
        {loadingMore ? <div className="rui-tasks-empty">Loading more…</div> : null}
      </div>
    </div>
  );
}
