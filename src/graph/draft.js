// The graph canvas's edit draft: how a shared draft (type edits, positions)
// materializes onto the published schema for rendering, and how a save turns
// it into a schema job through the ContextualGraph service. Hosts differ in
// how they reach the service, so saveDraft takes `request(path, init)`, a
// fetch bound to the host's base and auth (the CG app: its API host; the
// studio: its same-origin BFF). Schema jobs and graph reads come from the
// shared studio lib in both hosts.
import { semanticIndexFor, pollSchemaChange, vgraph } from './vgraph.js';

function applyTypeDraft(t, d, isVertex) {
  t.ui = { ...(t.ui || {}) };
  if (d.color != null) t.ui.color = d.color;
  if (d.icon != null) t.ui.icon = d.icon;
  if (d.labelProps != null) t.ui.labelProps = d.labelProps;
  if (d.description != null) t.description = d.description;
  for (const raw of d.props || []) {
    if (!raw.name || !raw.name.trim()) continue;
    const name = raw.name.trim();
    if ((t.properties || []).some((p) => p.name === name)) continue;
    const p = { name, type: raw.type || 'string' };
    if (p.type === 'vector') p.dimensions = Number(raw.dimensions) || null;
    t.properties = [...(t.properties || []), p];
    if (isVertex && p.type === 'string' && raw.semantic) {
      t.indices = [...(t.indices || []), semanticIndexFor(name)];
    }
  }
  if (!isVertex) {
    let conns = (t.connections || []).slice();
    for (const c of d.addConns || []) {
      if (!conns.some((x) => x.from_type === c.from_type && x.to_type === c.to_type)) {
        conns.push({ from_type: c.from_type, to_type: c.to_type });
      }
    }
    for (const c of d.removeConns || []) {
      conns = conns.filter((x) => !(x.from_type === c.from_type && x.to_type === c.to_type));
    }
    t.connections = conns;
  }
}

/** The draft as a FULL graph JSON: current truth + the pending edits, the
 *  shape POST /schema/save diffs against the DB. `positions` overrides
 *  ui.position per label (the rendered layout when a drag is pending). */
export function materializeDraft(graph, { typeDrafts = {}, positions = {} }) {
  const clone = JSON.parse(JSON.stringify(graph || {}));
  for (const vt of clone.vertex_types || []) {
    const label = vt.label || vt.name;
    vt.ui = { ...(vt.ui || {}) };
    if (positions[label]) vt.ui.position = { x: Math.round(positions[label].x), y: Math.round(positions[label].y) };
    const d = typeDrafts[`vertex:${label}`];
    if (d) applyTypeDraft(vt, d, true);
  }
  if (clone.node_types) clone.node_types = clone.vertex_types;
  for (const et of clone.edge_types || []) {
    const d = typeDrafts[`edge:${et.label || et.name}`];
    if (d) applyTypeDraft(et, d, false);
  }
  return clone;
}

/** The save endpoint's structured 400/409 details, in user language. */
function friendlyDetail(status, detail) {
  if (status === 409) {
    return 'Part of this schema is still being updated by an earlier change. Please try again in a moment.';
  }
  if (typeof detail === 'string' && detail) return detail;
  if (detail && typeof detail === 'object') {
    const items = (detail.problems || detail.violations || [])
      .map((v) => (v.where ? `${v.where}: ${v.error}` : v.error))
      .filter(Boolean)
      .slice(0, 6);
    return [detail.message || 'Some changes could not be applied.', ...items].join('\n');
  }
  return 'Your changes could not be saved. Please try again.';
}

/** Post the materialized draft; resolves to the post-save graph JSON.
 *  Destructive parts run as a background job — this waits for it, so the
 *  resolved graph is the settled truth. Throws Error with .friendly = true
 *  and a user-language message on the conflict contract.
 *  `client_clears_draft: true` tells the server NOT to blanket-clear the
 *  shared draft — the caller removes exactly the entries it consumed (see
 *  clearDraftEntries), so edits made during the save survive. */
export async function saveDraft(graphId, kb, draftGraph, { request }) {
  const res = await request(`/v1/cg/graphs/${encodeURIComponent(graphId)}/schema/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draft: draftGraph, client_clears_draft: true }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error(friendlyDetail(res.status, body && body.detail));
    err.friendly = true;
    err.status = res.status;
    throw err;
  }
  if (body && body.job_id) {
    const job = await pollSchemaChange(kb, body.job_id);
    if (job.status === 'failed') {
      const err = new Error('Part of this change could not be applied. The schema was reloaded; please review and try again.');
      err.friendly = true;
      throw err;
    }
    return vgraph.getGraph(kb, 'default');
  }
  return body && body.graph;
}
