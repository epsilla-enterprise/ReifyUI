// The files a turn produced, opened beside the conversation instead of printed into it.
//
// In the conversation a file is a card (the package's FileCard: its kind, Copy, Download, and the
// whole card opens it). Opened, it shows here, under ONE header row: the file's kind, its name as a
// switcher (a dropdown of every file of the conversation, grouped by folder, filterable when there are
// many, keyboard driven), then Copy, Download and Close. Below, the file rendered (Markdown as a
// document, code highlighted, images, PDFs, sheets). Docked, it is a column the host places beside the
// chat; `overlay` makes it a drawer over the page from the right, and on a phone the dropdown is a
// sheet from the bottom.
//
// Transport and rendering stay the host's, exactly as for FilePreview: `fetchFile` (with the
// host's auth), `renderMarkdown`, `officePdfUrl`, `parseWorkbook`, `onDownload`.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FilePreview } from '../components/FilePreview.jsx';
import { FileTypeIcon } from '../components/FileTypeIcon.jsx';
import { bytesLabel } from '../format.js';

const FILTER_AT = 8;   // more files than this, and the list opens with a filter box

/** "epsilla-enterprise-subscr…store-v2.png": the start and the end, which is where names differ. */
export function middleEllipsis(name, max = 40) {
  const s = String(name || '');
  if (s.length <= max) return s;
  const tail = Math.min(Math.max(10, Math.floor(max * 0.45)), max - 4);
  return `${s.slice(0, max - tail - 1)}…${s.slice(-tail)}`;
}

/** A name that truncates in the MIDDLE at whatever width it gets: the start shrinks with an ellipsis,
 *  the end (where similar names differ: "-v2", the extension) always shows. */
export function MidName(props) {
  const { name, className } = props;
  const s = String(name || '');
  const cut = s.length > 16 ? s.length - Math.min(14, Math.floor(s.length / 2)) : s.length;
  return (
    <span className={'uac-mid' + (className ? ` ${className}` : '')}>
      <span className="uac-mid-h">{s.slice(0, cut)}</span>{cut < s.length ? <span className="uac-mid-t">{s.slice(cut)}</span> : null}
    </span>
  );
}

function dirOf(path) {
  const p = String(path || '');
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

/** The name in the header, as a dropdown of every file. `files`: [{key, name, path?, size?, turn?}]. */
export function FileSwitcher(props) {
  const { files, current, onSelect, label = 'Files in this conversation', turnLabel = (n) => `Turn ${n}` } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const root = useRef(null);
  const list = useRef(null);
  const input = useRef(null);
  const btn = useRef(null);
  const id = useRef(`uac-fs-${Math.random().toString(36).slice(2, 9)}`).current;
  const cur = files.find((f) => f.key === current) || files[0];
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => files.filter((f) => !needle || String(f.path || f.name).toLowerCase().includes(needle)), [files, needle]);
  // by folder, in the order folders first appear; the root (no folder) first
  const groups = useMemo(() => {
    const by = new Map();
    for (const f of shown) {
      const d = dirOf(f.path);
      if (!by.has(d)) by.set(d, []);
      by.get(d).push(f);
    }
    return [...by.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : 0));
  }, [shown]);
  const flat = groups.flatMap(([, fs]) => fs);
  const grouped = groups.length > 1 || (groups.length === 1 && groups[0][0] !== '');
  const many = files.length > FILTER_AT;

  useEffect(() => {
    if (!open) return undefined;
    setHi(Math.max(0, flat.findIndex((f) => f.key === (cur && cur.key))));
    const t = setTimeout(() => { if (many && input.current) input.current.focus(); else if (list.current) list.current.focus(); }, 0);
    const away = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', away); document.removeEventListener('touchstart', away); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHi(0); }, [needle]);
  useEffect(() => {
    if (!open || !list.current) return;
    const el = list.current.querySelector(`[data-i="${hi}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  if (!cur) return null;
  const pick = (f) => { setOpen(false); setQ(''); if (f && onSelect) onSelect(f.key); if (btn.current) btn.current.focus(); };
  const keys = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setHi(0); }
    else if (e.key === 'End') { e.preventDefault(); setHi(flat.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(flat[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); if (btn.current) btn.current.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  const single = files.length < 2;
  let i = -1;
  return (
    <div ref={root} className={'uac-fs' + (open ? ' is-open' : '')}>
      <button ref={btn} type="button" className="uac-fs-btn" title={cur.path || cur.name} disabled={single}
        aria-haspopup={single ? undefined : 'listbox'} aria-expanded={single ? undefined : open} aria-controls={single ? undefined : id}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (!single && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); } }}>
        <MidName name={cur.name} className="uac-fs-name" />
        {single ? null : (
          <svg className="uac-fs-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        )}
      </button>
      {open ? (
        <>
          <div className="uac-fs-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="uac-fs-pop" onKeyDown={keys}>
            <div className="uac-fs-head"><span>{label}</span><span className="uac-fs-count">{files.length}</span></div>
            {many ? (
              <input ref={input} className="uac-fs-q" type="search" placeholder="Find a file" value={q} autoComplete="off" spellCheck={false}
                aria-label="Find a file" aria-controls={id} onChange={(e) => setQ(e.target.value)} />
            ) : null}
            <div ref={list} id={id} className="uac-fs-list" role="listbox" tabIndex={-1} aria-label={label}
              aria-activedescendant={flat[hi] ? `${id}-${hi}` : undefined}>
              {groups.map(([dir, fs]) => (
                <div key={dir || '.'} role="group" aria-label={dir || 'Top level'}>
                  {grouped ? <div className="uac-fs-dir" aria-hidden="true">{dir || 'Top level'}</div> : null}
                  {fs.map((f) => {
                    i += 1;
                    const n = i;
                    const on = f.key === cur.key;
                    const meta = [f.size != null ? bytesLabel(f.size) : '', f.turn != null ? turnLabel(f.turn) : ''].filter(Boolean).join(' · ');
                    return (
                      <div key={f.key} id={`${id}-${n}`} data-i={n} role="option" aria-selected={on}
                        className={'uac-fs-opt' + (on ? ' is-on' : '') + (n === hi ? ' is-hi' : '')}
                        title={f.path || f.name} onMouseEnter={() => setHi(n)} onClick={() => pick(f)}>
                        <FileTypeIcon name={f.name} size={16} />
                        <MidName name={f.name} className="uac-fs-on" />
                        {meta ? <span className="uac-fs-meta">{meta}</span> : null}
                        <span className="uac-fs-ck">{on ? <Check /> : null}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              {!flat.length ? <div className="uac-fs-none">No file matches.</div> : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * files: [{ key, name, url, path?, size?, turn? }] (key: stable id, e.g. the file id; path: where it
 * sits in the workspace, for folders; size in bytes and the turn that made it, when known).
 */
export function ArtifactPanel(props) {
  const {
    files = [], active, onSelect, onClose, overlay = false, label = 'Files in this conversation', turnLabel,
    fetchFile, renderMarkdown, officePdfUrl, parseWorkbook, onDownload, className,
  } = props;
  const ref = useRef(null);
  const cur = files.find((f) => f.key === active) || files[0] || null;
  // a drawer takes the focus and gives it back with Escape, like any dialog
  useEffect(() => {
    if (!overlay || !cur) return undefined;
    const back = document.activeElement;
    const t = setTimeout(() => { const b = ref.current && ref.current.querySelector('button'); if (b) b.focus(); }, 0);
    const key = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onClose && onClose(); } };
    document.addEventListener('keydown', key);
    return () => { clearTimeout(t); document.removeEventListener('keydown', key); if (back && back.focus) back.focus(); };
  }, [overlay, !!cur]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cur) return null;
  const switcher = <FileSwitcher files={files} current={cur.key} onSelect={onSelect} label={label} turnLabel={turnLabel} />;
  return (
    <>
      {overlay ? <div className="uac-art-scrim" aria-hidden="true" onClick={() => onClose && onClose()} /> : null}
      <div ref={ref} className={'uac-art' + (overlay ? ' is-overlay' : '') + (className ? ` ${className}` : '')}
        role={overlay ? 'dialog' : undefined} aria-modal={overlay ? 'true' : undefined} aria-label={overlay ? `Preview of ${cur.name}` : undefined}>
        <FilePreview key={cur.key} file={{ url: cur.url, name: cur.name }} onClose={onClose} nameSlot={switcher}
          fetchFile={fetchFile} renderMarkdown={renderMarkdown} officePdfUrl={officePdfUrl} parseWorkbook={parseWorkbook} onDownload={onDownload} />
      </div>
    </>
  );
}
