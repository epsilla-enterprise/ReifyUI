// Activity timeline — extracted from HarnessRouter's workbench.
// ToolGroup: a collapsible group whose summary is a natural-language recap ("Ran 5 commands,
// wrote a file"); open while the turn runs, auto-collapses when it concludes. Each ToolRow
// carries a typed icon + friendly label (+ filename chip) and expands to its Request / Result.
//
// Override slot: renderStep(step, idx) replaces the default ToolRow for a step (return
// undefined to fall through to the default).
import React, { useEffect, useState } from 'react';
import { Chevron, IcThink, IcCheck } from './icons.jsx';
import { toolMeta, summarizeSteps, prettyJson } from './toolMeta.js';

// Takes a single `props` object (destructured inside) so TSX consumers don't infer every slot
// as required.
export function ToolGroup(props) {
  const {
    reasoning, steps, running,
    workingLabel = 'Working…', thinkingLabel = 'Thinking', doneLabel = 'Done', thoughtLabel = 'Thought process',
    renderStep,
  } = props;
  // Open while the turn runs; auto-collapse to a one-line recap once it concludes.
  const [open, setOpen] = useState(running);
  useEffect(() => { setOpen(running); }, [running]);
  if (!reasoning && steps.length === 0) return null;
  const summary = running ? workingLabel : (steps.length ? summarizeSteps(steps) : thoughtLabel);
  return (
    <div className={'wbx-acts' + (open ? ' open' : '')}>
      <button className="wbx-acts-sum" onClick={() => setOpen((v) => !v)}>
        <Chevron dir={open ? 'down' : 'right'} size={13} /><span>{summary}</span>
      </button>
      {open && (
        <div className="wbx-acts-body">
          {reasoning && (
            <div className="wbx-act"><span className="wbx-act-ic-t thinking"><IcThink /></span>
              <div className="wbx-act-main"><div className="wbx-act-k">{thinkingLabel}</div>
                <div className="wbx-act-v">{reasoning}</div></div></div>
          )}
          {steps.map((s, j) => {
            if (renderStep) {
              const el = renderStep(s, j);
              if (el !== undefined) return <React.Fragment key={j}>{el}</React.Fragment>;
            }
            return <ToolRow key={j} step={s} />;
          })}
          {!running && (
            <div className="wbx-act"><span className="wbx-act-ic-t done"><IcCheck /></span>
              <div className="wbx-act-main"><div className="wbx-act-k">{doneLabel}</div></div></div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolRow(props) {
  const { step, requestLabel = 'Request', resultLabel = 'Result' } = props;
  const [open, setOpen] = useState(false);
  const meta = toolMeta(step.name, step.args);
  const Icon = meta.Icon;
  const hasDetail = !!(step.args && step.args !== '{}') || step.result !== undefined;
  return (
    <div className="wbx-act">
      <span className="wbx-act-ic-t"><Icon /></span>
      <div className="wbx-act-main">
        <button className={'wbx-act-row' + (open ? ' open' : '')} disabled={!hasDetail} onClick={() => setOpen((v) => !v)}>
          <span className="wbx-act-k">{meta.label}</span>
          {meta.chip && <span className="wbx-act-chip">{meta.chip}</span>}
          {hasDetail && <span className="wbx-act-exp"><Chevron dir={open ? 'down' : 'right'} size={12} /></span>}
        </button>
        {open && (
          <div className="wbx-act-detail">
            {step.args && step.args !== '{}' && (
              <div className="wbx-act-block"><div className="wbx-act-block-h">{requestLabel}</div>
                <pre className="wbx-act-pre">{prettyJson(step.args)}</pre></div>
            )}
            {step.result !== undefined && (
              <div className="wbx-act-block"><div className="wbx-act-block-h">{resultLabel}</div>
                <pre className="wbx-act-pre">{String(step.result).slice(0, 4000)}</pre></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
