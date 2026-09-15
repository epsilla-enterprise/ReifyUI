// A batch run of a sheet, as the grid's hosts see it. The service starts the
// run; the document's live channel carries every finished cell and the run's
// own transitions (useSheetCollab: sheet, liveRun), so this hook only
// needs start and stop. Hosts differ in auth, so the API calls are injected:
//   api.startRun(id, {tab, columns, rows, concurrency}) -> run summary
//   api.cancelRun(id, runId) -> run summary
import { useCallback, useEffect, useState } from 'react';

const ACTIVE = new Set(['running', 'cancelling']);
export const isRunActive = (run) => !!run && ACTIVE.has(run.status);

export function useSheetRun(resourceId, api, liveRun) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { setRun(null); setError(''); }, [resourceId]);

  // Adopt the channel's run when it is in progress (a reload, a run someone
  // else or the copilot started) or when it is the one already shown (its
  // outcome). A finished run from before this view opened stays out of the way.
  useEffect(() => {
    if (!liveRun) return;
    setRun((cur) => {
      if (isRunActive(liveRun) || (cur && cur.run_id === liveRun.run_id)) return liveRun;
      return cur;
    });
  }, [liveRun]);

  const start = useCallback(async (body) => {
    setError('');
    try {
      const r = await api.startRun(resourceId, body);
      setRun(r);
      return r;
    } catch (e) {
      setError(String(e?.message || e));
      return null;
    }
  }, [resourceId, api]);

  const cancel = useCallback(async () => {
    if (!isRunActive(run)) return;
    try { setRun(await api.cancelRun(resourceId, run.run_id)); }
    catch (e) { setError(String(e?.message || e)); }
  }, [resourceId, api, run]);

  const dismiss = useCallback(() => { setRun(null); setError(''); }, []);

  return { run, error, start, cancel, dismiss };
}

/** The tab with the run's pending cells shown as queued: every cell the run
 *  will fill that the run has not written yet (running, done, failed or
 *  skipped cells carry the run's id). */
export function withQueuedCells(tab, run) {
  if (!tab || !isRunActive(run) || run.tab_id !== tab.id) return tab;
  const rows = run.rows || (tab.rows || []).map((r) => r.id);
  const cells = { ...(tab.cells || {}) };
  let touched = false;
  for (const rid of rows) {
    for (const col of run.columns || []) {
      const key = `${rid}:${col.id}`;
      const cur = cells[key];
      if (cur && cur.run_id === run.run_id) continue;
      cells[key] = { ...(cur || {}), status: 'queued' };
      touched = true;
    }
  }
  return touched ? { ...tab, cells } : tab;
}

/** How many of the run's cells have a result so far. */
export function runProgress(tab, run) {
  if (!run) return 0;
  let n = 0;
  for (const cell of Object.values(tab?.cells || {})) {
    if (cell && cell.run_id === run.run_id && cell.status !== 'running') n += 1;
  }
  return n;
}
