// The files a turn produced, opened beside the conversation instead of printed into it.
//
// In the conversation a file is a card (the package's FileCard: its kind, Copy, Download, and the
// whole card opens it). Opened, it shows here: the file rendered (Markdown as a document, code
// highlighted, images, PDFs, sheets), a switcher across every file the conversation made, Copy,
// Download and Close. Docked, it is a column the host places beside the chat; `overlay` makes it a
// drawer over the page from the right, which is what a narrow screen gets.
//
// Transport and rendering stay the host's, exactly as for FilePreview: `fetchFile` (with the
// host's auth), `renderMarkdown`, `officePdfUrl`, `parseWorkbook`, `onDownload`.
import React, { useEffect, useRef } from 'react';
import { FilePreview } from '../components/FilePreview.jsx';
import { FileTypeIcon } from '../components/FileTypeIcon.jsx';

/**
 * files: [{ key, name, url }] (key: stable id, e.g. the file id); active: the key shown.
 */
export function ArtifactPanel(props) {
  const {
    files = [], active, onSelect, onClose, overlay = false, label = 'Files in this conversation',
    fetchFile, renderMarkdown, officePdfUrl, parseWorkbook, onDownload, className,
  } = props;
  const ref = useRef(null);
  const cur = files.find((f) => f.key === active) || files[0] || null;
  // a drawer takes the focus and gives it back with Escape, like any dialog
  useEffect(() => {
    if (!overlay || !cur) return undefined;
    const back = document.activeElement;
    const t = setTimeout(() => { const b = ref.current && ref.current.querySelector('button'); if (b) b.focus(); }, 0);
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); } };
    document.addEventListener('keydown', key);
    return () => { clearTimeout(t); document.removeEventListener('keydown', key); if (back && back.focus) back.focus(); };
  }, [overlay, !!cur]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cur) return null;
  const switcher = files.length > 1 ? (
    <nav className="uac-art-files" aria-label={label}>
      {files.map((f) => (
        <button key={f.key} type="button" className={'uac-art-file' + (f.key === cur.key ? ' is-on' : '')}
          aria-current={f.key === cur.key ? 'true' : undefined} title={f.name} onClick={() => onSelect && onSelect(f.key)}>
          <FileTypeIcon name={f.name} size={14} /><span>{f.name}</span>
        </button>
      ))}
    </nav>
  ) : null;
  return (
    <>
      {overlay ? <div className="uac-art-scrim" aria-hidden="true" onClick={() => onClose && onClose()} /> : null}
      <div ref={ref} className={'uac-art' + (overlay ? ' is-overlay' : '') + (className ? ` ${className}` : '')}
        role={overlay ? 'dialog' : undefined} aria-modal={overlay ? 'true' : undefined} aria-label={overlay ? `Preview of ${cur.name}` : undefined}>
        <FilePreview key={cur.key} file={{ url: cur.url, name: cur.name }} onClose={onClose} before={switcher}
          fetchFile={fetchFile} renderMarkdown={renderMarkdown} officePdfUrl={officePdfUrl} parseWorkbook={parseWorkbook} onDownload={onDownload} />
      </div>
    </>
  );
}
