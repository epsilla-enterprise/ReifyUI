// ConnectPane — the Connect tab: this graph as an MCP server for external
// agents. Two stacked regions in one pane:
//   1. The connection card: ONE connection method (the MCP client JSON with
//      the graph's real endpoint substituted) + the API keys as compact rows
//      inside the same card. Progressive disclosure: with >=1 key the card
//      collapses to a slim summary bar (endpoint, Copy config, key count,
//      chevron); with no keys it starts expanded with the create-key callout.
//   2. The tools master/detail split: a slim list on the left (mono name +
//      enabled toggle, run_query pinned first) and the modeless editor /
//      test bench on the right (ConnectToolDetail). Below ~720px of PANE
//      width the split goes single-pane (list <-> detail with a back
//      control), measured on the pane so the resizable chat column counts.
//
// Registry toggles PUT optimistically with rollback; copilot changes converge
// live through the realtime "connect" meta key (GraphPage passes it down)
// with a refetch-on-focus fallback.
//
// House rules honored here: no native popups (the package's Modal only),
// every number from live data ("—" when absent), no internal architecture in
// any copy.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cable, Check, ChevronDown, Copy, KeyRound, Plus,
} from 'lucide-react';
import { CodeBlock } from '../components/CodeBlock.jsx';
import { relativeTime } from './format.js';
import { Modal } from '../components/Modal.jsx';
import { Skeleton } from './Skeleton.jsx';
import { ConnectToolDetail, RUN_QUERY_TOOL, Switch } from './ConnectToolDetail.jsx';

const NARROW_PX = 720;   // pane width where the split goes single-pane

function normalizeRegistry(reg) {
  return {
    raw_enabled: !!reg?.raw_enabled,
    tools: Array.isArray(reg?.tools) ? reg.tools : [],
  };
}

/** The one connection method: MCP client JSON with the real endpoint URL. */
function mcpConfigJson(url) {
  return JSON.stringify({
    mcpServers: {
      graph: {
        command: 'npx',
        args: ['-y', 'mcp-remote', url, '--header', 'Authorization: Bearer YOUR_KEY'],
      },
    },
  }, null, 2);
}

/** Middle truncation for the summary bar (full URL rides in title). */
function truncateMiddle(s, max = 52) {
  if (!s || s.length <= max) return s;
  const head = Math.ceil((max - 1) * 0.6);
  const tail = (max - 1) - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

// ── small shared control ────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy', sm = true }) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (insecure context): selection fallback.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more we can do */ }
      ta.remove();
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1600);
  };
  return (
    <button type="button" className={'btn' + (sm ? ' sm' : '')} onClick={copy}>
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? 'Copied' : label}
    </button>
  );
}

// ── connection card ─────────────────────────────────────────────────────────

function KeyRow({ k, onRevoke }) {
  return (
    <div className="cn-key-row">
      <span className="cn-key-name" title={k.name}><KeyRound size={13} aria-hidden="true" />{k.name || '—'}</span>
      <code className="mono cn-key-prefix">{k.prefix ? `${k.prefix}…` : '—'}</code>
      <span className="cn-key-meta">
        <span className="cn-key-lbl">Created</span> {relativeTime(k.created_at) || '—'}
      </span>
      <span className="cn-key-meta">
        <span className="cn-key-lbl">Last used</span> {relativeTime(k.last_used) || '—'}
      </span>
      <button type="button" className="btn sm danger cn-key-revoke" onClick={onRevoke}>Revoke</button>
    </div>
  );
}

function ConnectionCard({ url, keys, expanded, onToggle, onCreateKey, onRevoke }) {
  const hasKeys = keys.length > 0;
  const config = url ? mcpConfigJson(url) : '';
  const keyCount = `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`;
  return (
    <section className="cn-conn">
      <div className="cn-conn-bar">
        <button
          type="button"
          className="cn-conn-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className={'cn-conn-chev' + (expanded ? ' open' : '')} aria-hidden="true"><ChevronDown size={15} /></span>
          <Cable size={14} aria-hidden="true" />
          <code className="mono cn-conn-url" title={url || undefined}>{url ? truncateMiddle(url) : '—'}</code>
          <span className="cn-conn-count num">{keyCount}</span>
        </button>
        {url && <CopyButton text={config} label="Copy config" />}
      </div>

      {expanded && (
        <div className="cn-conn-body">
          {url ? <CodeBlock code={config} language="json" className="cn-code" /> : <div className="cn-hint">—</div>}
          <p className="cn-caption">
            Works with Claude Desktop, Claude Code, and any MCP client. Replace YOUR_KEY with an API key.
          </p>
          {hasKeys ? (
            <>
              <div className="cn-keys-h">
                <h4>API keys</h4>
                <button type="button" className="btn sm" onClick={onCreateKey}>
                  <Plus size={13} /> Create key
                </button>
              </div>
              <div className="cn-keys">
                {keys.map((k) => <KeyRow key={k.id} k={k} onRevoke={() => onRevoke(k)} />)}
              </div>
            </>
          ) : (
            <div className="cn-callout">
              <KeyRound size={14} aria-hidden="true" />
              <span>Agents need an API key to connect. Create your first key to get started.</span>
              <button type="button" className="btn sm primary" onClick={onCreateKey}>Create key</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── key dialogs (flow unchanged: name -> POST -> secret shown ONCE) ─────────

function CreateKeyDialog({ busy, error, onSubmit, onClose }) {
  const [name, setName] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const ok = name.trim().length > 0;
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Create API key" width={420} classNames={{ root: 'cn-dlg' }}>
      <div className="cn-dlg-body">Name the key after the agent or place that will use it, so you can tell keys apart later.</div>
      <form onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onSubmit(name.trim()); }}>
        <input
          ref={ref}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. claude-desktop"
          maxLength={80}
        />
        {error && <div className="cn-err">{error}</div>}
        <div className="cn-dlg-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!ok || busy}>
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SecretDialog({ secret, onClose }) {
  return (
    <Modal open onClose={onClose} title="Your new API key" width={480} classNames={{ root: 'cn-dlg' }}>
      <div className="cn-dlg-body">
        Copy this key now and store it somewhere safe. For your security, it will not be shown again.
      </div>
      <div className="cn-secret">
        <code className="mono">{secret.key}</code>
      </div>
      <div className="cn-dlg-foot">
        <CopyButton text={secret.key} label="Copy key" sm={false} />
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

// A confirmation whose action runs while it stays open (revoke, delete, discard): the body
// is the pane's own, so a failed action is reported right there.
function ConfirmModal({ title, body, confirmLabel = 'Delete', busy, onConfirm, onClose }) {
  return (
    <Modal open onClose={busy ? undefined : onClose} title={title} width={420} classNames={{ root: 'cn-dlg' }}>
      <div className="cn-dlg-body">{body}</div>
      <div className="cn-dlg-foot">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn danger" onClick={onConfirm} disabled={busy}>
          {busy ? `${confirmLabel}…` : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ── tools list (master side) ────────────────────────────────────────────────

function ToolListRow({ name, builtin, enabled, selected, busy, onSelect, onToggle }) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={'cn-lrow' + (selected ? ' sel' : '') + (enabled ? '' : ' off')}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
    >
      <code className="mono cn-lrow-name" title={name}>{name}</code>
      {builtin && <span className="pill brand">Built in</span>}
      {/* Toggle clicks must not change the selection. */}
      <span
        className="cn-lrow-toggle"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Switch checked={!!enabled} disabled={busy} onChange={onToggle} label={`Enable ${name}`} />
      </span>
    </div>
  );
}

function ToolList({ registry, sel, busy, onSelect, onToggleRaw, onToggleTool, onNew }) {
  return (
    <div className="cn-list">
      <div className="cn-list-h">
        <button type="button" className="btn sm primary cn-new-tool" onClick={onNew}>
          <Plus size={13} /> New tool
        </button>
      </div>
      <div className="cn-list-scroll scroll" role="listbox" aria-label="Tools">
        <ToolListRow
          name={RUN_QUERY_TOOL}
          builtin
          enabled={registry.raw_enabled}
          selected={sel.type === 'builtin'}
          busy={busy}
          onSelect={() => onSelect({ type: 'builtin' })}
          onToggle={onToggleRaw}
        />
        {registry.tools.map((t) => (
          <ToolListRow
            key={t.name}
            name={t.name}
            enabled={!!t.enabled}
            selected={sel.type === 'tool' && sel.name === t.name}
            busy={busy}
            onSelect={() => onSelect({ type: 'tool', name: t.name })}
            onToggle={(v) => onToggleTool(t.name, v)}
          />
        ))}
        {sel.type === 'draft' && (
          <div role="option" aria-selected="true" className="cn-lrow sel cn-lrow-draft" tabIndex={0}>
            <span className="cn-lrow-name">New tool</span>
          </div>
        )}
        {registry.tools.length === 0 && (
          <div className="cn-list-empty">
            A tool is a named, parameterized query agents can call safely. Define one
            here, or ask your copilot to create it for you.
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectSkeleton() {
  return (
    <div className="cn-skel" aria-busy="true" aria-label="Loading Connect">
      <Skeleton w="100%" h={38} radius={9} />
      <div className="cn-skel-split">
        <div className="cn-skel-col">
          <Skeleton w="100%" h={30} radius={9} style={{ marginBottom: 8 }} />
          <Skeleton w="100%" h={30} radius={9} style={{ marginBottom: 8 }} />
          <Skeleton w="100%" h={30} radius={9} />
        </div>
        <div className="cn-skel-col">
          <Skeleton w="42%" h={16} style={{ marginBottom: 12 }} />
          <Skeleton w="100%" h={90} radius={9} style={{ marginBottom: 10 }} />
          <Skeleton w="100%" h={90} radius={9} />
        </div>
      </div>
    </div>
  );
}

// ── the pane ────────────────────────────────────────────────────────────────

/** `client`: {getConnect, putConnect, listConnectKeys, createConnectKey, revokeConnectKey,
 *  testConnectTool, endpointUrl(path)} bound to the host's API and auth. */
export function ConnectPane({ graphId, liveRegistry, client }) {
  const [registry, setRegistry] = useState(null);
  const [keys, setKeys] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);            // a registry PUT in flight

  // Selection: builtin run_query (pinned first, the on-load default), one
  // defined tool by name, or an unsaved draft.
  const [sel, setSel] = useState({ type: 'builtin' });
  const [showDetail, setShowDetail] = useState(false); // narrow single-pane: list <-> detail
  const [narrow, setNarrow] = useState(false);
  const dirtyRef = useRef({ dirty: false, label: '' }); // the detail form's unsaved-edit state

  // Connection card disclosure: collapsed by default once keys exist,
  // expanded when there are none (component state, not persisted).
  const [cardExpanded, setCardExpanded] = useState(false);
  const cardInitRef = useRef(false);

  const [confirm, setConfirm] = useState(null);       // {kind:'revoke',key} | {kind:'delete',tool} | {kind:'discard',next,label}
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [secret, setSecret] = useState(null);         // {id, name, key} shown ONCE
  // The endpoint PATH comes from the server (it names the graph's data-plane
  // id, which the client must not derive) — realtime registry pushes never
  // carry it, so it lives outside the registry state.
  const [endpoint, setEndpoint] = useState('');

  const registryRef = useRef(null);
  registryRef.current = registry;
  const paneRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [reg, ks] = await Promise.all([client.getConnect(graphId), client.listConnectKeys(graphId)]);
      if (reg && typeof reg.endpoint === 'string') setEndpoint(reg.endpoint);
      setRegistry(normalizeRegistry(reg));
      setKeys(ks);
      if (!cardInitRef.current) {
        cardInitRef.current = true;
        setCardExpanded((ks || []).length === 0);
      }
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load Connect settings.');
    } finally {
      setLoading(false);
    }
  }, [graphId, client]);

  useEffect(() => { load(); }, [load]);

  // Fallback convergence: refetch when the tab regains visibility/focus.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState !== 'hidden') load(); };
    window.addEventListener('focus', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onVis);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  // Live convergence: a registry published on the graph's realtime channel
  // (copilot connect_* tools, another member's save) is fresher truth.
  useEffect(() => {
    if (liveRegistry && (Array.isArray(liveRegistry.tools) || 'raw_enabled' in liveRegistry)) {
      setRegistry(normalizeRegistry(liveRegistry));
    }
  }, [liveRegistry]);

  // Single-pane threshold, measured on the PANE (the resizable chat column
  // changes pane width without a viewport resize; 200% zoom halves it too).
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === 'number') setNarrow(w < NARROW_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A selected tool deleted elsewhere (realtime push) falls back to the
  // pinned built-in — unless the form holds unsaved edits.
  useEffect(() => {
    if (!registry || sel.type !== 'tool') return;
    if (!registry.tools.some((t) => t.name === sel.name) && !dirtyRef.current.dirty) {
      setSel({ type: 'builtin' });
    }
  }, [registry, sel]);

  /** Optimistic whole-registry save with rollback (toggles, deletes). */
  const saveRegistry = useCallback(async (next) => {
    const prev = registryRef.current;
    setRegistry(next);
    setSaveError('');
    setBusy(true);
    try {
      const saved = await client.putConnect(graphId, next);
      if (saved && (Array.isArray(saved.tools) || 'raw_enabled' in saved)) {
        setRegistry(normalizeRegistry(saved));
      }
      return true;
    } catch (e) {
      setRegistry(prev);
      setSaveError(e?.message || 'Could not save your change.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [graphId, client]);

  const toggleRaw = (v) => saveRegistry({ ...registryRef.current, raw_enabled: v });
  const toggleTool = (name, v) => saveRegistry({
    ...registryRef.current,
    tools: registryRef.current.tools.map((t) => (t.name === name ? { ...t, enabled: v } : t)),
  });

  /** Detail save: NOT optimistic — awaited so validation errors land back in
   *  the form per-field. prevName is null on create, ≠ def.name on rename.
   *  The selection follows the saved (possibly renamed) tool. */
  const saveTool = useCallback(async (def, prevName) => {
    const cur = registryRef.current;
    const rest = cur.tools.filter((t) => t.name !== prevName && t.name !== def.name);
    const kept = cur.tools.find((t) => t.name === prevName);
    const idx = cur.tools.findIndex((t) => t.name === prevName);
    const tools = [...rest];
    tools.splice(idx >= 0 ? idx : tools.length, 0, { ...kept, ...def });
    const saved = await client.putConnect(graphId, { ...cur, tools });
    setRegistry(saved && (Array.isArray(saved.tools) || 'raw_enabled' in saved)
      ? normalizeRegistry(saved)
      : { ...cur, tools });
    setSaveError('');
    setSel({ type: 'tool', name: def.name });
  }, [graphId, client]);

  // ── selection with an unsaved-edits guard ────────────────────────────────
  const sameSel = (a, b) => a.type === b.type
    && (a.type !== 'tool' || a.name === b.name)
    && (a.type !== 'draft' || a.nonce === b.nonce);
  const applySelect = useCallback((next) => {
    setSel(next);
    setShowDetail(true);
  }, []);
  const requestSelect = useCallback((next) => {
    if (sameSel(next, sel)) { setShowDetail(true); return; }
    if (dirtyRef.current.dirty) {
      setConfirmError('');
      setConfirm({ kind: 'discard', next, label: dirtyRef.current.label });
      return;
    }
    applySelect(next);
  }, [sel, applySelect]);
  const onDirtyChange = useCallback((dirty, label) => {
    dirtyRef.current = { dirty, label };
  }, []);

  const doConfirm = async () => {
    if (!confirm) return;
    if (confirm.kind === 'discard') {
      applySelect(confirm.next);
      setConfirm(null);
      return;
    }
    setConfirmBusy(true);
    setConfirmError('');
    try {
      if (confirm.kind === 'revoke') {
        await client.revokeConnectKey(graphId, confirm.key.id);
        setKeys(await client.listConnectKeys(graphId));
      } else {
        const cur = registryRef.current;
        const ok = await saveRegistry({ ...cur, tools: cur.tools.filter((t) => t.name !== confirm.tool.name) });
        if (!ok) throw new Error('Could not delete this tool. Please try again.');
        if (sel.type === 'tool' && sel.name === confirm.tool.name) {
          setSel({ type: 'builtin' });
          setShowDetail(false);
        }
      }
      setConfirm(null);
    } catch (e) {
      setConfirmError(e?.message || 'Something went wrong. Please try again.');
    } finally {
      setConfirmBusy(false);
    }
  };

  const doCreateKey = async (name) => {
    setCreateBusy(true);
    setCreateError('');
    try {
      const minted = await client.createConnectKey(graphId, name);
      setCreatingKey(false);
      setSecret(minted);
      setKeys(await client.listConnectKeys(graphId));
    } catch (e) {
      setCreateError(e?.message || 'Could not create the key. Please try again.');
    } finally {
      setCreateBusy(false);
    }
  };

  const url = endpoint ? client.endpointUrl(endpoint) : '';
  const selTool = sel.type === 'tool'
    ? (registry?.tools || []).find((t) => t.name === sel.name) || null
    : null;
  const detailKey = sel.type === 'draft' ? `draft:${sel.nonce}`
    : sel.type === 'builtin' ? 'builtin'
      : `tool:${sel.name}`;

  return (
    <div className="gp-placeholder cn-root">
      <div className="pane" style={{ flex: 1 }} ref={paneRef}>
        {loading ? (
          <ConnectSkeleton />
        ) : error ? (
          <div className="pane-empty">
            <Cable size={28} />
            <div className="big">Could not load Connect</div>
            <div>{error}</div>
            <button type="button" className="btn sm" onClick={() => { setLoading(true); load(); }}>Try again</button>
          </div>
        ) : (
          <div className="cn-body scroll">
            <ConnectionCard
              url={url}
              keys={keys || []}
              expanded={cardExpanded}
              onToggle={() => setCardExpanded((v) => !v)}
              onCreateKey={() => { setCreateError(''); setCreatingKey(true); }}
              onRevoke={(k) => { setConfirmError(''); setConfirm({ kind: 'revoke', key: k }); }}
            />

            {saveError && <div className="cn-err cn-err-top">{saveError}</div>}

            <div className={'cn-split' + (narrow ? ' narrow' : '') + (narrow && showDetail ? ' show-detail' : '')}>
              <ToolList
                registry={registry}
                sel={sel}
                busy={busy}
                onSelect={requestSelect}
                onToggleRaw={toggleRaw}
                onToggleTool={toggleTool}
                onNew={() => requestSelect({ type: 'draft', nonce: Date.now() })}
              />
              {(sel.type === 'builtin' || sel.type === 'draft' || selTool || dirtyRef.current.dirty) ? (
                <ConnectToolDetail
                  key={detailKey}
                  client={client}
                  graphId={graphId}
                  tool={selTool}
                  builtin={sel.type === 'builtin'}
                  isDraft={sel.type === 'draft'}
                  enabled={sel.type === 'builtin' ? registry.raw_enabled : !!selTool?.enabled}
                  busy={busy}
                  takenNames={new Set([RUN_QUERY_TOOL, ...(registry?.tools || []).map((t) => t.name)])}
                  narrow={narrow}
                  onBack={() => setShowDetail(false)}
                  onToggle={sel.type === 'builtin' ? toggleRaw : (v) => toggleTool(sel.name, v)}
                  onSave={saveTool}
                  onDelete={() => { setConfirmError(''); setConfirm({ kind: 'delete', tool: selTool }); }}
                  onDirtyChange={onDirtyChange}
                />
              ) : (
                <div className="cn-detail">
                  <div className="pane-empty">Select a tool to edit and test it.</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.kind === 'revoke' ? `Revoke "${confirm.key.name}"?`
            : confirm.kind === 'delete' ? `Delete "${confirm.tool.name}"?`
              : `Discard unsaved changes to "${confirm.label}"?`}
          body={(
            <>
              {confirm.kind === 'revoke'
                ? 'Agents using this key will lose access immediately. This cannot be undone.'
                : confirm.kind === 'delete'
                  ? 'Agents will no longer be able to call this tool. This cannot be undone.'
                  : 'Your edits have not been saved and will be lost.'}
              {confirmError && <div className="cn-err">{confirmError}</div>}
            </>
          )}
          confirmLabel={confirm.kind === 'revoke' ? 'Revoke' : confirm.kind === 'delete' ? 'Delete' : 'Discard'}
          busy={confirmBusy}
          onConfirm={doConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
      {creatingKey && (
        <CreateKeyDialog
          busy={createBusy}
          error={createError}
          onSubmit={doCreateKey}
          onClose={() => setCreatingKey(false)}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}
