// One produced file, as a card: type glyph, name, what it is, download, preview.
//
// The same card under a chat answer and inside a spreadsheet cell. Those two started as different
// things — a full-width row with a Preview button, and a bare text chip — which is how one surface
// ends up with a download affordance the other never got.
//
// There is ONE card. There was briefly a `compact` variant for grid cells, which shrank the
// actions to two 20px glyphs on a tinted background; it was a worse version of the thing it was
// a variant of, which is what a variant usually is. A cell narrow enough to need a different card
// is a cell too narrow to show the file at all — the name ellipsises and the card still works.
import { FileTypeIcon, extOf } from './FileTypeIcon.jsx';
import { useEffect, useState } from 'react';
import { IcDownload } from './icons.jsx';

const IcCopy = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>;
const IcCheckMark = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>;

/** "PPTX · output" — what it is, then where it came from. `origin` is the caller's word. */
function subtitle(name, origin, bytes) {
  const parts = [(extOf(name) || 'file').toUpperCase()];
  if (origin) parts.push(origin);
  if (bytes != null) parts.push(bytesLabel(bytes));
  return parts.join(' · ');
}

export function bytesLabel(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function FileCard({ name, origin = 'output', bytes, onPreview, onDownload, onCopy, active = false, thumb, className = '' }) {
  // Copy: the host copies the file's text (it owns the read); the card says it did, briefly.
  const [copied, setCopied] = useState('');
  useEffect(() => { if (!copied) return undefined; const t = setTimeout(() => setCopied(''), 1600); return () => clearTimeout(t); }, [copied]);
  // The whole card opens the preview, and the eye repeats it as an explicit target — a card that
  // is clickable without saying so is a card people do not click.
  const open = onPreview ? (e) => { e.stopPropagation(); onPreview(); } : undefined;
  return (
    <div className={'uic-filecard' + (open ? ' is-clickable' : '') + (active ? ' is-active' : '') + (className ? ' ' + className : '')}
         aria-current={active ? 'true' : undefined}
         onClick={open}
         role={open ? 'button' : undefined}
         tabIndex={open ? 0 : undefined}
         onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } } : undefined}
         title={name}>
      {/* an image shows itself (the host hands a url it can read, e.g. an object url); else its kind */}
      {thumb ? <span className="uic-filecard-thumb"><img src={thumb} alt="" /></span>
        : <span className="uic-filecard-ic"><FileTypeIcon name={name} size={32} /></span>}
      <span className="uic-filecard-meta">
        <span className="uic-filecard-name">{name}</span>
        <span className="uic-filecard-sub">{subtitle(name, origin, bytes)}</span>
      </span>
      {onCopy && (
        <button type="button" className="uic-filecard-dl uic-filecard-copy" aria-label={copied === 'ok' ? 'Copied' : `Copy ${name}`}
                title={copied === 'ok' ? 'Copied' : copied === 'no' ? 'Could not copy' : 'Copy'}
                onClick={async (e) => { e.stopPropagation(); try { await onCopy(); setCopied('ok'); } catch { setCopied('no'); } }}>
          {copied === 'ok' ? <IcCheckMark /> : <IcCopy />}
        </button>
      )}
      {onDownload && (
        <button type="button" className="uic-filecard-dl" aria-label={`Download ${name}`} title="Download"
                onClick={(e) => { e.stopPropagation(); onDownload(); }}>
          <IcDownload size={18} />
        </button>
      )}
      {onPreview && (
        <button type="button" className="uic-filecard-open" aria-label={`Preview ${name}`} onClick={open}>
          Preview
        </button>
      )}
    </div>
  );
}
