// One produced file, as a card: type glyph, name, what it is, download, preview.
//
// The same card under a chat answer and inside a spreadsheet cell. Those two started as different
// things — a full-width row with a Preview button, and a bare text chip — which is how one surface
// ends up with a download affordance the other never got.
//
// `compact` is the only difference between them, and it is a size, not a second component: in a
// grid cell there is room for a glyph and a name, so the sub-line and the button labels collapse
// to icons. Everything remains reachable.
import { Fragment } from 'react';
import { FileTypeIcon, extOf } from './FileTypeIcon.jsx';
import { IcDownload, IcEye } from './icons.jsx';

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

export function FileCard({
  name, origin, bytes, onPreview, onDownload, compact = false, className = '',
}) {
  // The whole card opens the preview, and the eye repeats it as an explicit target — a card that
  // is clickable without saying so is a card people do not click.
  const open = onPreview ? (e) => { e.stopPropagation(); onPreview(); } : undefined;
  return (
    <div className={'uic-filecard' + (compact ? ' is-compact' : '') + (open ? ' is-clickable' : '')
                    + (className ? ' ' + className : '')}
         onClick={open}
         role={open ? 'button' : undefined}
         tabIndex={open ? 0 : undefined}
         onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } } : undefined}
         title={name}>
      <span className="uic-filecard-ic"><FileTypeIcon name={name} size={compact ? 20 : 30} /></span>
      <span className="uic-filecard-meta">
        <span className="uic-filecard-name">{name}</span>
        {!compact && <span className="uic-filecard-sub">{subtitle(name, origin, bytes)}</span>}
      </span>
      <Fragment>
        {onDownload && (
          <button type="button" className="uic-filecard-btn" aria-label={`Download ${name}`} title="Download"
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}>
            <IcDownload />
          </button>
        )}
        {onPreview && (
          <button type="button" className="uic-filecard-btn" aria-label={`Preview ${name}`} title="Preview"
                  onClick={open}>
            <IcEye />
          </button>
        )}
      </Fragment>
    </div>
  );
}
