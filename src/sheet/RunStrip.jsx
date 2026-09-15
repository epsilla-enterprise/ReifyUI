// The run's one line in the tabs bar: what is filling, how far along, Stop;
// then the outcome until dismissed. Every number is the run's own.
import React from 'react';
import { isRunActive } from './useSheetRun.js';

// The outcome as counted from the document; a run closed while the document
// could not be read carries no counts, and says nothing rather than zeros.
function outcome(run) {
  const c = run.counts;
  if (!c) return '';
  const parts = [`${c.done || 0} done`];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  return parts.join(', ');
}

export function RunStrip({ run, error, filled = 0, onCancel, onDismiss }) {
  if (!run && !error) return null;
  let text = error;
  let tone = 'failed';
  if (run) {
    const names = (run.columns || []).map((c) => c.name).join(', ');
    const total = run.cell_count || 0;
    tone = run.status;
    if (run.status === 'running') {
      text = `Filling ${names}: ${filled} of ${total} cells, ${run.concurrency} rows at a time`;
    } else if (run.status === 'cancelling') {
      text = `Stopping after the cells in flight: ${filled} of ${total} cells`;
    } else if (run.status === 'done') {
      const o = outcome(run);
      text = o ? `Filled ${names}: ${o}` : `Filled ${names}`;
    } else if (run.status === 'cancelled') {
      const c = run.counts;
      const o = outcome(run);
      const notRun = c ? Math.max(0, total - ((c.done || 0) + (c.failed || 0) + (c.skipped || 0))) : null;
      text = o ? `Stopped: ${o}, ${notRun} not run` : 'Stopped';
    } else {
      const o = outcome(run);
      text = run.error ? `The run stopped early: ${run.error}` : 'The run could not start';
      if (o) text += ` (${o})`;
      tone = 'failed';
    }
  }
  const active = isRunActive(run);
  return (
    <div className={`shg-run shg-run-${tone}`} role="status" aria-live="polite">
      <span className="shg-run-dot" aria-hidden="true" />
      <span className="shg-run-text" title={text}>{text}</span>
      {active ? (
        <button type="button" className="shg-run-stop" onClick={onCancel}
                disabled={run.status === 'cancelling'}>Stop</button>
      ) : (
        <button type="button" className="shg-run-x" onClick={onDismiss} aria-label="Dismiss">×</button>
      )}
    </div>
  );
}
