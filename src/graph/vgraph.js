// vg-gateway client — talks to the same-origin Next BFF (/api/vg/*), which
// forwards to the AgentStudio VectorGraph Gateway server-side. The graph schema
// is authoritative in the VectorGraph management Cosmos; this is how the Spaces
// Graph asset reads it. Mirrors admin.js's shape so the GraphPage schema view
// can be pointed here with minimal change.

// Transport override — lets a non-studio consumer (ContextualGraph's Vite SPA)
// point this client at its own vg passthrough with its own auth headers. The
// studio never calls configureVgraph and keeps the same-origin BFF default.
let _transport = null;
export function configureVgraph(t) { _transport = t; }

async function send(method, path, body) {
  const opts = { method, headers: _transport && _transport.headers ? { ..._transport.headers() } : {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const base = (_transport && _transport.base) || '/api/vg';
  const res = await fetch(base + path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`vg-gateway ${res.status} on ${method} ${path}: ${text || res.statusText}`);
    // Callers branch on the status (409 = label fenced by a running schema
    // change job; 404/405 = route not shipped on this deployment yet).
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// A Graph asset binds to "<kb_uuid>#<subgraph>".
export function parseAssetRef(ref) {
  const [kb, subgraph] = String(ref || '').split('#');
  return { kb: kb || '', subgraph: subgraph || '' };
}

// schema_version ("major.minor", INTEGER minor: "2.9" -> "2.10") as a
// comparable number. Number("2.10") === 2.1 < 2.9, so a naive cast inverts
// the ordering the moment minor hits double digits — live pushes then look
// stale, clients pin on old truth, and saves persist the stale render (the
// lost-color/position bug). major*1e6+minor keeps it monotonic and larger
// than any legacy float stamp.
export function schemaVersionNum(v) {
  const s = String(v == null ? '' : v);
  const m = s.match(/^(\d+)\.(\d+)$/);
  if (m) return Number(m[1]) * 1e6 + Number(m[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n * 1e6 : 0;
}

export const vgraph = {
  // Adapted KnowledgeBaseSchema → GraphPage shape (vertex_types/edge_types).
  getGraph(kb, subgraph) {
    const q = subgraph ? `?subgraph=${encodeURIComponent(subgraph)}` : '';
    return send('GET', `/v1/graphs/${encodeURIComponent(kb)}${q}`);
  },
  health() {
    return send('GET', '/healthz');
  },

  // ── Mutations (each returns the re-adapted graph for the subgraph) ──────
  patchUi(kb, subgraph, kind, label, ui) {
    return send('PATCH', `/v1/graphs/${encodeURIComponent(kb)}/ui`, { subgraph, kind, label, ui });
  },
  addVertexType(kb, subgraph, label, description, ui) {
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/vertex-types`, { subgraph, label, description, ui });
  },
  addEdgeType(kb, subgraph, label, description, connections, ui) {
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/edge-types`, { subgraph, label, description, connections, ui });
  },
  // Type meta (description). The label itself is immutable identity.
  patchTypeMeta(kb, subgraph, kind, label, description) {
    const seg = kind === 'edge' ? 'edge-types' : 'vertex-types';
    return send('PATCH', `/v1/graphs/${encodeURIComponent(kb)}/${seg}/${encodeURIComponent(label)}`, { subgraph, description });
  },
  addVertexProperty(kb, subgraph, label, prop) {
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/vertex-types/${encodeURIComponent(label)}/properties`, { subgraph, ...prop });
  },
  addEdgeProperty(kb, subgraph, label, prop) {
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/edge-types/${encodeURIComponent(label)}/properties`, { subgraph, ...prop });
  },
  // Property PATCH: attribute updates (default/description/ui) and/or a rename
  // via new_name — schema-doc level; stored values are not migrated.
  patchProperty(kb, subgraph, kind, label, name, patch) {
    const seg = kind === 'edge' ? 'edge-types' : 'vertex-types';
    return send('PATCH', `/v1/graphs/${encodeURIComponent(kb)}/${seg}/${encodeURIComponent(label)}/properties/${encodeURIComponent(name)}`, { subgraph, ...patch });
  },
  // Property DELETE: schema-doc level — values already stored on records stay
  // in place but are no longer read or written. Indexed properties 400.
  deleteProperty(kb, subgraph, kind, label, name) {
    const seg = kind === 'edge' ? 'edge-types' : 'vertex-types';
    return send('DELETE', `/v1/graphs/${encodeURIComponent(kb)}/${seg}/${encodeURIComponent(label)}/properties/${encodeURIComponent(name)}?subgraph=${encodeURIComponent(subgraph)}`);
  },
  // Indices. A semantic index on a string property makes the write path
  // auto-embed the value into the d{dimensions} vector slot.
  addIndex(kb, subgraph, kind, label, index) {
    const seg = kind === 'edge' ? 'edge-types' : 'vertex-types';
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/${seg}/${encodeURIComponent(label)}/indices`, { subgraph, ...index });
  },
  removeIndex(kb, subgraph, kind, label, indexName) {
    const seg = kind === 'edge' ? 'edge-types' : 'vertex-types';
    return send('DELETE', `/v1/graphs/${encodeURIComponent(kb)}/${seg}/${encodeURIComponent(label)}/indices/${encodeURIComponent(indexName)}?subgraph=${encodeURIComponent(subgraph)}`);
  },
  // Schema-change jobs — mutations WITH data sync (drop a type incl. its
  // records, drop/rename/retype a property incl. per-record migration). POST
  // returns { job_id, status }; poll getSchemaChange until done|failed. While
  // a job runs its labels are fenced: writes to them 409.
  scheduleSchemaChange(kb, op, params) {
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/schema-changes`, { op, params, created_at: new Date().toISOString() });
  },
  getSchemaChange(kb, jobId) {
    return send('GET', `/v1/graphs/${encodeURIComponent(kb)}/schema-changes/${encodeURIComponent(jobId)}`);
  },
  addConnection(kb, subgraph, label, from_type, to_type) {
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/edge-types/${encodeURIComponent(label)}/connections`, { subgraph, from_type, to_type });
  },
  removeConnection(kb, subgraph, label, from_type, to_type) {
    const q = `subgraph=${encodeURIComponent(subgraph)}&from_type=${encodeURIComponent(from_type)}&to_type=${encodeURIComponent(to_type)}`;
    return send('DELETE', `/v1/graphs/${encodeURIComponent(kb)}/edge-types/${encodeURIComponent(label)}/connections?${q}`);
  },

  // ── Instance data plane (vertices). Edges/neighbors deferred (lib gap). ──
  listInstances(kb, label, limit = 50) {
    return send('GET', `/v1/graphs/${encodeURIComponent(kb)}/instances?label=${encodeURIComponent(label)}&limit=${limit}`);
  },
  createInstance(kb, label, properties) {
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/instances`, { label, properties });
  },
  neighbors(kb, vertexId, limit = 50) {
    return send('GET', `/v1/graphs/${encodeURIComponent(kb)}/instances/${encodeURIComponent(vertexId)}/neighbors?limit=${limit}`);
  },
  // Free-text search across all vertices (semantic + fulltext where available;
  // substring today). Returns { results: [{id,label,title,fields}] }.
  searchAll(kb, q, limit = 20) {
    return send('GET', `/v1/graphs/${encodeURIComponent(kb)}/search?q=${encodeURIComponent(q || '')}&limit=${limit}`);
  },
  // Raw Gremlin++ over the tenant. Rejects (throws) on syntax/other errors so the
  // caller can tell a valid query from free text. Returns { data, vertex_ids, … }.
  gremlin(kb, query) {
    return send('POST', '/v1/gremlin', { query, tenant_id: kb });
  },
  // Indexed full-text search (case-insensitive substring) via the textSearch step,
  // across common text properties, merged + de-duped. The gateway rejects MULTIPLE
  // textSearch steps in one query, so fire one per property in parallel; a property
  // that isn't FTS-indexed just returns nothing (harmless). Returns { data: [rows] }
  // of valueMap(true) vertex rows. Callers fall back to searchAll on empty/error.
  async searchFts(kb, q, props = ['name', 'email', 'title', 'body', 'slug', 'display_name']) {
    const esc = String(q || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    if (!esc.trim()) return { data: [] };
    const settled = await Promise.allSettled(props.map((p) =>
      send('POST', '/v1/gremlin', {
        query: `g.V().textSearch('${p}', '${esc}').limit(20).valueMap(true)`, tenant_id: kb,
      })));
    const byId = new Map();
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      for (const row of (s.value.data || [])) {
        if (row && row.id != null && !byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return { data: [...byId.values()] };
  },
  createEdge(kb, label, from_id, to_id, properties = {}) {
    return send('POST', `/v1/graphs/${encodeURIComponent(kb)}/edges`, { label, from_id, to_id, properties });
  },
};

// TODO(schema-batch): a batched mutation route (POST /v1/graphs/{kb}/schema-batch)
// is being built in parallel. Once it ships, add `schemaBatch(kb, subgraph, ops)`
// here and swap SpacesGraphView's saveChanges per-op loop to ONE call — the op
// list construction stays, only the transport changes.

// VectorGraph DataType enum — drives the property type dropdown. Used directly
// (no SQL→type mapping); mirrors schema_manager/models.py:DataType.
export const DATA_TYPES = ['string', 'integer', 'double', 'boolean', 'datetime', 'json', 'file', 'vector'];

// ── Semantic search helpers ─────────────────────────────────────────────────
// The platform embeds with ONE flexible-dims Azure OpenAI model; the "@<dims>"
// suffix pins an index's vectors to a fixed DiskANN slot (384/768/1536/3072).
// Mirrors backend/contextualgraph/app/templates.py:DIM_EMBEDDERS.
const EMBEDDER_BASE = 'azure/text-embedding-3-large';

// Fields that read as long-form prose get the wider 1536-dim slot; everything
// else (names, titles, tags, short labels) does fine at 384.
const LONG_TEXT_NAME = /(body|content|description|summary|note|text|bio|about|detail|transcript|comment|review|message|abstract|story)/i;

export function semanticDimsFor(propName) {
  return LONG_TEXT_NAME.test(String(propName || '')) ? 1536 : 384;
}

/** IndexDefinition body for turning semantic search on for a string property. */
export function semanticIndexFor(propName, dims) {
  const d = dims || semanticDimsFor(propName);
  return { name: `${propName}_semantic`, property: propName, type: 'semantic', embedder: `${EMBEDDER_BASE}@${d}`, dimensions: d };
}

/** The semantic index covering `propName`, if the type has one. */
export function semanticIndexOn(type, propName) {
  return ((type && type.indices) || []).find((i) => i.type === 'semantic' && i.property === propName) || null;
}

/** Poll a schema-change job until it leaves pending/running. onTick gets each
 *  job doc (progress.step etc). Resolves the final doc; rejects on timeout. */
export async function pollSchemaChange(kb, jobId, { intervalMs = 1200, timeoutMs = 180000, onTick } = {}) {
  const t0 = Date.now();
  for (;;) {
    const job = await vgraph.getSchemaChange(kb, jobId);
    if (onTick) onTick(job);
    if (job.status === 'done' || job.status === 'failed') return job;
    if (Date.now() - t0 > timeoutMs) throw new Error(`schema change ${jobId} still ${job.status} after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
