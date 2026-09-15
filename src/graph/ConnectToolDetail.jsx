// ConnectToolDetail — the modeless right-hand pane of the Connect tab's tools
// (host-agnostic: the graph service is reached through the injected `client`).
// split: one tool's definition editor and an always-visible "Try it" bench.
// Replaces the old ConnectToolEditor + ConnectTestRunner dialogs; the form,
// validation and test logic carried over intact, only the modality changed.
//
// Three shapes:
//   - defined tool: Definition section (name, description, params table,
//     query) with per-field validation mapped from PUT 400 problems, one
//     primary Save (disabled until dirty), then Try it, then a quiet
//     destructive "Delete tool" text button.
//   - built-in run_query: fixed description + Try it with a query textarea
//     (no Definition, no delete).
//   - draft (new tool): empty Definition, focus in name, Save creates.
//     Nothing saved yet, so no Try it and no delete.
//
// Dirty tracking: the form is compared against the saved baseline; the parent
// hears about it (onDirtyChange) to guard selection switches. Realtime
// registry pushes re-sync a CLEAN form to the fresh tool; a dirty form keeps
// the user's edits. "Try it" always runs the SAVED tool (POST /connect/test
// by name) — a dirty form shows a quiet note next to Run.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Play, Plus, Trash2 } from 'lucide-react';
import { CodeBlock } from '../components/CodeBlock.jsx';
import { fmtUnits } from './format.js';

export const RUN_QUERY_TOOL = 'run_query';
export const RUN_QUERY_DESCRIPTION =
  'Run any query. Lets a connected agent read and change anything in this graph '
  + 'with free-form queries. Turn it off to limit agents to the tools you define.';

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const NAME_HINT = 'Lowercase letters, digits and underscores, starting with a letter.';
const PARAM_TYPES = ['string', 'number', 'boolean'];

// ── shared toggle (list rows + detail header import it from here) ──────────
export function Switch({ checked, onChange, disabled, label }) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="slider" />
    </label>
  );
}

let rowSeq = 0;
const newRow = (p = {}) => ({
  key: `r${rowSeq++}`,
  name: p.name || '',
  type: PARAM_TYPES.includes(p.type) ? p.type : 'string',
  description: p.description || '',
  required: p.required !== false,
  default: p.default == null ? '' : String(p.default),
});
const initRows = (tool) => (tool?.params || []).map(newRow);
// Comparable shape (row keys dropped) for the dirty check.
const normRows = (rows) => rows.map((r) => (
  { name: r.name, type: r.type, description: r.description, required: !!r.required, default: r.default }
));

function TypeSelect({ value, onChange, disabled }) {
  return (
    <span className="select-wrap cn-type-sel">
      <select className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Parameter type">
        {PARAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <span className="chev"><ChevronDown size={13} /></span>
    </span>
  );
}

/** Typed default from the row's raw text; {value} on success, {error} on a
 *  value that does not fit the declared type. Empty text = no default. */
function parseDefault(row) {
  const raw = row.default.trim();
  if (!raw) return { value: undefined };
  if (row.type === 'number') {
    const n = Number(raw);
    return isFinite(n) ? { value: n } : { error: 'Default must be a number.' };
  }
  if (row.type === 'boolean') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'Default must be true or false.' };
  }
  return { value: raw };
}

/** Map the server's structured validation problems onto editor fields.
 *  Anything we cannot place lands in the general error list. */
function mapServerErrors(detail, rows) {
  const out = { fields: {}, params: {}, general: [] };
  if (typeof detail === 'string' && detail) { out.general.push(detail); return out; }
  if (!detail || typeof detail !== 'object') { out.general.push('Your changes could not be saved.'); return out; }
  const items = detail.problems || detail.violations || detail.errors || [];
  if (detail.message) out.general.push(detail.message);
  for (const it of items) {
    const where = String(it?.where || it?.field || '').toLowerCase();
    const msg = it?.error || it?.message || String(it);
    if (['name', 'description', 'query'].includes(where)) out.fields[where] = msg;
    else if (rows.some((r) => r.name === where)) out.params[where] = msg;
    else out.general.push(where ? `${where}: ${msg}` : msg);
  }
  if (!out.general.length && !items.length && !detail.message) out.general.push('Your changes could not be saved.');
  return out;
}

// ── Try it — always-visible test bench for the SAVED tool ───────────────────

function initialValues(params) {
  const v = {};
  for (const p of params || []) v[p.name] = p.default == null ? '' : String(p.default);
  return v;
}

function BoolSelect({ value, onChange, disabled, label, id }) {
  return (
    <span className="select-wrap cn-type-sel">
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label}>
        <option value="">not set</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
      <span className="chev"><ChevronDown size={13} /></span>
    </span>
  );
}

function TryIt({ client, graphId, tool, builtin, dirty }) {
  const params = tool?.params || [];
  const [values, setValues] = useState(() => initialValues(params));
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState({});      // param name -> msg
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState(null);    // {data, consumption}
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const errs = {};
    const args = {};
    if (builtin) {
      if (!query.trim()) { setRunError('Enter a query to run.'); return; }
      args.query = query;
    } else {
      for (const p of params) {
        const raw = String(values[p.name] ?? '').trim();
        if (!raw) {
          // Empty and optional: leave it out; the tool's own default applies.
          if (p.required && p.default == null) errs[p.name] = 'Required.';
          continue;
        }
        if (p.type === 'number') {
          const n = Number(raw);
          if (!isFinite(n)) { errs[p.name] = 'Must be a number.'; continue; }
          args[p.name] = n;
        } else if (p.type === 'boolean') {
          args[p.name] = raw === 'true';
        } else {
          args[p.name] = raw;
        }
      }
    }
    setErrors(errs);
    setRunError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    setResult(null);
    try {
      const body = await client.testConnectTool(graphId, builtin ? RUN_QUERY_TOOL : tool.name, args);
      setResult(body);
    } catch (e) {
      setRunError(e?.message || 'The test run failed.');
    } finally {
      setBusy(false);
    }
  };

  const units = result ? fmtUnits(result.consumption) : null;
  let dataText = '';
  if (result) {
    try { dataText = JSON.stringify(result.data ?? null, null, 2); } catch { dataText = String(result.data); }
  }

  return (
    <section className="cn-dsec">
      <h4 className="cn-dsec-h">Try it</h4>
      <p className="cn-hint cn-dsec-sub">Runs this tool exactly as a connected agent would, without needing an API key.</p>
      <form className="cn-try" onSubmit={(e) => { e.preventDefault(); if (!busy) run(); }}>
        {builtin ? (
          <div className="field">
            <label htmlFor="cn-try-q">Query</label>
            <textarea
              id="cn-try-q"
              className="textarea mono cn-ed-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={4}
              placeholder="g.V().limit(5)"
              spellCheck={false}
              disabled={busy}
            />
          </div>
        ) : params.length ? (
          <div className="cn-test-params">
            {params.map((p) => (
              <div key={p.name} className="field cn-test-field">
                <label htmlFor={`cn-try-${p.name}`}>
                  <span className="mono">{p.name}</span>
                  <span className="cn-hint"> {p.type}{p.required ? ', required' : ''}</span>
                </label>
                {p.type === 'boolean' ? (
                  <BoolSelect
                    id={`cn-try-${p.name}`}
                    value={String(values[p.name] ?? '')}
                    onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))}
                    disabled={busy}
                    label={p.name}
                  />
                ) : (
                  <input
                    id={`cn-try-${p.name}`}
                    className={'input sm' + (p.type === 'number' ? ' mono' : '')}
                    inputMode={p.type === 'number' ? 'decimal' : undefined}
                    value={values[p.name] ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, [p.name]: e.target.value }))}
                    placeholder={p.description || p.name}
                    disabled={busy}
                  />
                )}
                {errors[p.name] && <div className="cn-err">{errors[p.name]}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="cn-hint">This tool takes no parameters.</div>
        )}

        {runError && <div className="cn-err">{runError}</div>}

        <div className="cn-try-run">
          {dirty && <span className="cn-hint cn-try-note">Testing the last saved version</span>}
          <button type="submit" className="btn sm" disabled={busy}>
            <Play size={13} /> {busy ? 'Running…' : 'Run'}
          </button>
        </div>
      </form>

      {result && (
        <div className="cn-test-result">
          <div className="cn-test-units mono">{units || '—'}</div>
          <CodeBlock code={dataText} language="json" className="cn-test-json" />
        </div>
      )}
    </section>
  );
}

// ── the detail pane ─────────────────────────────────────────────────────────

export function ConnectToolDetail({
  client, graphId, tool, builtin, isDraft, enabled, busy, takenNames, narrow,
  onBack, onToggle, onSave, onDelete, onDirtyChange,
}) {
  const [name, setName] = useState(tool?.name || '');
  const [description, setDescription] = useState(tool?.description || '');
  const [query, setQuery] = useState(tool?.query || '');
  const [rows, setRows] = useState(() => initRows(tool));
  const [fieldErrors, setFieldErrors] = useState({});   // name/description/query -> msg
  const [paramErrors, setParamErrors] = useState({});   // row key -> msg
  const [general, setGeneral] = useState([]);
  const [saving, setSaving] = useState(false);
  const baselineRef = useRef(tool || null);             // last SAVED definition

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const dirty = useMemo(() => {
    if (builtin) return false;
    const b = baselineRef.current;
    return name !== (b?.name || '')
      || description !== (b?.description || '')
      || query !== (b?.query || '')
      || JSON.stringify(normRows(rows)) !== JSON.stringify(normRows(initRows(b)));
  }, [builtin, name, description, query, rows]);

  // Parent hears about dirtiness (it guards selection switches with a
  // discard confirm); a labeled name makes the confirm copy specific.
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(dirty, baselineRef.current?.name || name.trim() || 'new tool');
  }, [dirty, name]);
  useEffect(() => () => { onDirtyRef.current?.(false, ''); }, []);

  // Realtime convergence: a fresh registry push re-syncs a CLEAN form; a
  // dirty form keeps the user's edits (the list still updates around it).
  useEffect(() => {
    if (builtin || isDraft || !tool || tool === baselineRef.current || dirty) return;
    baselineRef.current = tool;
    setName(tool.name || '');
    setDescription(tool.description || '');
    setQuery(tool.query || '');
    setRows(initRows(tool));
  }, [tool, dirty, builtin, isDraft]);

  // Soft placeholder cross-check: never blocks (the server is the authority),
  // just points out likely mistakes before a failed save.
  const placeholderHint = useMemo(() => {
    if (builtin) return '';
    const used = new Set((query.match(/\$[a-z][a-z0-9_]*/g) || []).map((s) => s.slice(1)));
    const declared = new Set(rows.map((r) => r.name).filter(Boolean));
    const undeclared = [...used].filter((n) => !declared.has(n));
    const unused = [...declared].filter((n) => !used.has(n));
    const bits = [];
    if (undeclared.length) bits.push(`$${undeclared.join(', $')} in the query has no matching parameter`);
    if (unused.length) bits.push(`parameter ${unused.join(', ')} is never used in the query`);
    return bits.join('; ');
  }, [builtin, query, rows]);

  /** Save: client-side validation, then the awaited parent save; server 400
   *  problems come back per-field. NOT optimistic — errors keep the edits. */
  const submit = async () => {
    const fe = {};
    const pe = {};

    const nm = name.trim();
    if (!NAME_RE.test(nm)) fe.name = NAME_HINT;
    else if (nm !== baselineRef.current?.name && takenNames.has(nm)) fe.name = 'A tool with this name already exists.';
    if (!query.trim()) fe.query = 'The query cannot be empty.';

    const seen = new Set();
    const params = [];
    for (const r of rows) {
      const pn = r.name.trim();
      if (!NAME_RE.test(pn)) { pe[r.key] = NAME_HINT; continue; }
      if (seen.has(pn)) { pe[r.key] = 'Duplicate parameter name.'; continue; }
      seen.add(pn);
      const def = parseDefault(r);
      if (def.error) { pe[r.key] = def.error; continue; }
      const p = { name: pn, type: r.type, description: r.description.trim(), required: !!r.required };
      if (def.value !== undefined) p.default = def.value;
      params.push(p);
    }

    setFieldErrors(fe);
    setParamErrors(pe);
    setGeneral([]);
    if (Object.keys(fe).length || Object.keys(pe).length) return;

    const def = {
      name: nm,
      description: description.trim(),
      query,
      params,
      enabled: baselineRef.current?.enabled !== false,
    };
    setSaving(true);
    try {
      await onSave(def, isDraft ? null : baselineRef.current?.name || null);
      // Clean baseline = what we just saved (a rename/create remounts this
      // component through the parent's selection follow; harmless here).
      baselineRef.current = def;
      setName(def.name);
      setDescription(def.description);
      setQuery(def.query);
      setRows(initRows(def));
    } catch (e) {
      const mapped = mapServerErrors(e?.detail ?? e?.message, rows.map((r) => ({ ...r, name: r.name.trim() })));
      setFieldErrors(mapped.fields);
      // Server problems name params by param name; translate to row keys.
      const byKey = {};
      for (const r of rows) {
        if (mapped.params[r.name.trim()]) byKey[r.key] = mapped.params[r.name.trim()];
      }
      setParamErrors(byKey);
      setGeneral(mapped.general);
    } finally {
      setSaving(false);
    }
  };

  const headName = builtin ? RUN_QUERY_TOOL
    : isDraft ? (name.trim() || 'New tool')
      : (baselineRef.current?.name || name);
  const disabledForms = saving;
  // The saved definition drives Try it (POST /connect/test runs by name);
  // key resets its inputs when the saved params actually change.
  const savedParamsKey = JSON.stringify((tool?.params || []).map((p) => [p.name, p.type, p.default ?? null]));

  return (
    <div className="cn-detail">
      <div className="cn-dhead">
        {narrow && (
          <button type="button" className="btn sm ghost cn-dback" onClick={onBack}>
            <ArrowLeft size={14} /> Tools
          </button>
        )}
        <code className="mono cn-dname" title={headName}>{headName}</code>
        {builtin && <span className="pill brand">Built in</span>}
        {!isDraft && (
          <Switch
            checked={!!enabled}
            disabled={busy}
            onChange={onToggle}
            label={`Enable ${headName}`}
          />
        )}
      </div>

      <div className="cn-dscroll scroll">
        {builtin ? (
          <p className="cn-ddesc">{RUN_QUERY_DESCRIPTION}</p>
        ) : (
          <section className="cn-dsec">
            <h4 className="cn-dsec-h">Definition</h4>
            <p className="cn-hint cn-dsec-sub">
              A tool is a named query agents can call with typed parameters. Keep the
              description specific; it is what agents read to decide when to use it.
            </p>
            <form className="cn-ed" onSubmit={(e) => { e.preventDefault(); if (!saving) submit(); }}>
              <div className="field">
                <label htmlFor="cn-ed-name">Name</label>
                <input
                  id="cn-ed-name"
                  className="input mono"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="overdue_tickets"
                  maxLength={64}
                  disabled={disabledForms}
                  autoFocus={isDraft}
                />
                {fieldErrors.name && <div className="cn-err">{fieldErrors.name}</div>}
              </div>

              <div className="field">
                <label htmlFor="cn-ed-desc">Description</label>
                <input
                  id="cn-ed-desc"
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this tool returns and when to use it"
                  disabled={disabledForms}
                />
                {fieldErrors.description && <div className="cn-err">{fieldErrors.description}</div>}
              </div>

              <div className="field">
                <div className="cn-ed-params-h">
                  <label>Parameters</label>
                  <button type="button" className="btn sm" onClick={() => setRows((rs) => [...rs, newRow()])} disabled={disabledForms}>
                    <Plus size={13} /> Add parameter
                  </button>
                </div>
                {rows.length > 0 && (
                  <div className="cn-ed-params">
                    <div className="cn-ed-prow cn-ed-phead" aria-hidden="true">
                      <span>Name</span><span>Type</span><span>Description</span><span>Required</span><span>Default</span><span />
                    </div>
                    {rows.map((r) => (
                      <div key={r.key} className="cn-ed-prow-wrap">
                        <div className="cn-ed-prow">
                          <input
                            className="input sm mono"
                            value={r.name}
                            onChange={(e) => setRow(r.key, { name: e.target.value })}
                            placeholder="name"
                            aria-label="Parameter name"
                            maxLength={64}
                            disabled={disabledForms}
                          />
                          <TypeSelect value={r.type} onChange={(t) => setRow(r.key, { type: t })} disabled={disabledForms} />
                          <input
                            className="input sm"
                            value={r.description}
                            onChange={(e) => setRow(r.key, { description: e.target.value })}
                            placeholder="What it means"
                            aria-label="Parameter description"
                            disabled={disabledForms}
                          />
                          <label className="cn-ed-req">
                            <input
                              type="checkbox"
                              checked={r.required}
                              onChange={(e) => setRow(r.key, { required: e.target.checked })}
                              disabled={disabledForms}
                            />
                            <span>Required</span>
                          </label>
                          <input
                            className="input sm mono"
                            value={r.default}
                            onChange={(e) => setRow(r.key, { default: e.target.value })}
                            placeholder={r.type === 'boolean' ? 'true / false' : 'none'}
                            aria-label="Default value"
                            disabled={disabledForms}
                          />
                          <button
                            type="button"
                            className="iconbtn danger"
                            title="Remove parameter"
                            aria-label="Remove parameter"
                            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                            disabled={disabledForms}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {paramErrors[r.key] && <div className="cn-err">{paramErrors[r.key]}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="cn-ed-query">Query</label>
                <textarea
                  id="cn-ed-query"
                  className="textarea mono cn-ed-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  rows={5}
                  placeholder={"g.V().hasLabel('Customer').has('name', $customer).limit($limit)"}
                  spellCheck={false}
                  disabled={disabledForms}
                />
                <div className="cn-hint">
                  Use $name placeholders for parameters. Values are always inserted as safe typed
                  literals, never as raw text.
                </div>
                {placeholderHint && <div className="cn-warn">{placeholderHint}</div>}
                {fieldErrors.query && <div className="cn-err">{fieldErrors.query}</div>}
              </div>

              {general.map((g, i) => <div key={i} className="cn-err">{g}</div>)}

              <div className="cn-ed-save">
                <button type="submit" className="btn primary" disabled={saving || !dirty}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </section>
        )}

        {!isDraft && (
          <TryIt key={savedParamsKey} client={client} graphId={graphId} tool={tool} builtin={builtin} dirty={dirty} />
        )}

        {!builtin && !isDraft && (
          <div className="cn-dfoot">
            <button type="button" className="cn-del" onClick={onDelete}>Delete tool</button>
          </div>
        )}
      </div>
    </div>
  );
}
