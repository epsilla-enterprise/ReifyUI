// One produced file, rendered. Images, pdf, video, audio, Markdown, spreadsheets, delimited text
// and code all render inline; anything else says so and offers the download.
//
// Ported from the HarnessRouter console, where it was already the answer, so a file previews the
// same wherever it is opened. Two things changed on the way in, both because a package cannot
// assume a product:
//
//   - transport is injected. The console fetches with an auth header; a kit is same-origin and
//     needs none. `fetchFile` defaults to a plain fetch, which is right for same-origin callers.
//   - markdown and code render through props. The package does not depend on a markdown library,
//     and it already ships one code renderer (CodeBlock) — adding a second highlighter to render
//     the same text twice is the duplication this component exists to argue against.
//
// `officePdfUrl` is how a caller offers a server-rendered PDF for formats no browser draws
// (pptx, docx, odp). Without it those fall through to the download, honestly labelled.
import { useEffect, useState } from 'react';
import { FileTypeIcon, extOf } from './FileTypeIcon.jsx';
import { CodeBlock } from './CodeBlock.jsx';
import { IcDownload, IcX } from './icons.jsx';

const LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript',
  tsx: 'typescript', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
  sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', css: 'css', scss: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', json: 'json', yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini', r: 'r', lua: 'lua', pl: 'perl', dockerfile: 'dockerfile', diff: 'diff',
};

// Presentations and word documents render faithfully through the server's PDF rendition.
// Spreadsheets render as a real grid instead — a PDF of a sheet is the wrong mental model.
const OFFICE = new Set(['pptx', 'ppt', 'pptm', 'odp', 'doc', 'docx', 'odt', 'rtf']);
const SHEET = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'ods']);

function kindOf(name, mime = '') {
  const e = extOf(name);
  if (mime.startsWith('image/') || /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(e)) return 'image';
  if (mime === 'application/pdf' || e === 'pdf') return 'pdf';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v'].includes(e)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(e)) return 'audio';
  if (e === 'csv' || e === 'tsv') return 'csv';
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (SHEET.has(e)) return 'sheet';
  if (OFFICE.has(e)) return 'office';
  if (mime.startsWith('text/') || LANG[e] || /^(txt|log|env|conf|cfg|gitignore)$/.test(e)) return 'code';
  return 'binary';
}

function delimitedToRows(text, sep) {
  return text.split(/\r?\n/).filter((l) => l.length).slice(0, 1000).map((line) => {
    const out = []; let cur = ''; let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.replace(/^"|"$/g, ''));
  });
}

function Grid({ rows }) {
  if (!rows?.length) return <div className="uic-fp-empty">This file is empty.</div>;
  const [head, ...body] = rows;
  return (
    <div className="uic-fp-sheet">
      <table>
        <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const defaultDownload = (url, name) => {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noreferrer';
  document.body.appendChild(a); a.click(); a.remove();
};

export function FilePreview({
  file, onClose, fetchFile, officePdfUrl, renderMarkdown, onDownload, title,
}) {
  const { url, name } = file || {};
  const [st, setSt] = useState({ kind: 'loading' });
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    let obj;
    setSt({ kind: 'loading' });
    setTab(0);
    const get = fetchFile || ((u) => fetch(u, { cache: 'no-store' }));

    (async () => {
      const res = await get(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const mime = (res.headers.get('content-type') || '').toLowerCase();
      const kind = kindOf(name, mime);

      if (kind === 'office') {
        // The rendition needs the same transport, so it is fetched to a blob rather than handed
        // to an <iframe src> that would carry no credentials.
        if (!officePdfUrl) {
          setSt({ kind: 'binary', error: 'This format has no inline preview here — download it to open it.' });
          return;
        }
        const r = await get(officePdfUrl(url));
        if (!r.ok) throw new Error(`${r.status}`);
        obj = URL.createObjectURL(await r.blob());
        if (alive) setSt({ kind: 'pdf', objUrl: obj });
        return;
      }
      if (kind === 'sheet') {
        try {
          const buf = await res.arrayBuffer();
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buf, { type: 'array' });
          // sheet_to_json THROWS on a sheet with no '!ref' — an empty one — and losing that threw
          // away the whole workbook rather than one tab. Tools routinely leave an empty default
          // Sheet1 in front of the real data, so this was most spreadsheets.
          const sheets = wb.SheetNames.map((n) => {
            const ws = wb.Sheets[n] || {};
            const filled = Boolean(ws['!ref']);
            return { name: n, filled, rows: filled ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) : [] };
          });
          // Open on the first sheet that has something: opening on an empty one reads as a broken
          // preview rather than as an empty tab.
          const first = sheets.findIndex((s) => s.filled);
          if (alive) { setTab(first < 0 ? 0 : first); setSt({ kind: 'sheet', sheets }); }
        } catch (e) {
          if (alive) setSt({ kind: 'binary', error: `This spreadsheet couldn’t be read (${String(e?.message || 'parse failed').slice(0, 80)}).` });
        }
        return;
      }
      if (kind === 'csv' || kind === 'markdown' || kind === 'code') {
        const text = await res.text();
        if (!alive) return;
        if (kind === 'csv') setSt({ kind: 'csv', rows: delimitedToRows(text, extOf(name) === 'tsv' ? '\t' : ',') });
        else setSt({ kind, text: text.slice(0, 400000) });
        return;
      }
      if (kind === 'binary') { if (alive) setSt({ kind: 'binary' }); return; }
      obj = URL.createObjectURL(await res.blob());
      if (alive) setSt({ kind, objUrl: obj });
    })().catch(() => { if (alive) setSt({ kind: 'binary', error: 'Could not load this file.' }); });

    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [url, name, fetchFile, officePdfUrl]);

  const download = () => (onDownload ? onDownload(url, name) : defaultDownload(url, name));

  return (
    <aside className="uic-fp" aria-label={title || `Preview of ${name}`}>
      <header className="uic-fp-head">
        <span className="uic-fp-ic"><FileTypeIcon name={name} size={20} /></span>
        <span className="uic-fp-name" title={name}>{name}</span>
        <button type="button" className="uic-fp-btn" aria-label={`Download ${name}`} title="Download"
                onClick={download}><IcDownload /></button>
        {onClose && (
          <button type="button" className="uic-fp-btn" aria-label="Close preview" title="Close"
                  onClick={onClose}><IcX size={18} /></button>
        )}
      </header>

      <div className="uic-fp-body">
        {st.kind === 'loading' && <div className="uic-fp-pad"><span className="uic-skel uic-fp-skel" /></div>}
        {st.kind === 'image' && st.objUrl && <div className="uic-fp-center"><img className="uic-fp-img" src={st.objUrl} alt={name} /></div>}
        {st.kind === 'pdf' && st.objUrl && <iframe className="uic-fp-frame" src={st.objUrl} title={name} />}
        {st.kind === 'video' && st.objUrl && <div className="uic-fp-center"><video className="uic-fp-media" src={st.objUrl} controls /></div>}
        {st.kind === 'audio' && st.objUrl && <div className="uic-fp-center"><audio src={st.objUrl} controls /></div>}
        {st.kind === 'markdown' && (
          <div className="uic-fp-doc">
            {renderMarkdown ? renderMarkdown(st.text || '') : <pre className="uic-fp-pre">{st.text}</pre>}
          </div>
        )}
        {st.kind === 'code' && <CodeBlock code={st.text || ''} lang={LANG[extOf(name)] || 'plaintext'} />}
        {st.kind === 'csv' && <Grid rows={st.rows} />}
        {st.kind === 'sheet' && st.sheets && (
          <div className="uic-fp-xlsx">
            {st.sheets[tab]?.filled ? <Grid rows={st.sheets[tab].rows} />
                                    : <div className="uic-fp-empty">This sheet is empty.</div>}
            {/* Shown even for one sheet: the tab bar is what tells someone they are looking at a
                workbook, and hiding it is what made an empty first sheet read as a failure. */}
            <div className="uic-fp-tabs">
              {st.sheets.map((s, i) => (
                <button key={s.name + i} type="button"
                        className={'uic-fp-tab' + (i === tab ? ' is-on' : '') + (s.filled ? '' : ' is-empty')}
                        onClick={() => setTab(i)} title={s.filled ? s.name : `${s.name} (empty)`}>{s.name}</button>
              ))}
            </div>
          </div>
        )}
        {st.kind === 'binary' && (
          <div className="uic-fp-center">
            <div className="uic-fp-fallback">
              <FileTypeIcon name={name} size={56} />
              <p>{st.error || 'No inline preview for this file type.'}</p>
              <button type="button" className="uic-fp-dl" onClick={download}>Download</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
