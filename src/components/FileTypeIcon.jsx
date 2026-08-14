// The coloured file-type glyph — pdf red, docx blue, xlsx green, pptx orange, py yellow.
//
// react-file-icon is the standard library for this and it is already what the HarnessRouter
// console draws, so a file looks the same wherever it appears: a card under an answer, a card in
// a spreadsheet cell, the header of a preview pane. Redrawing these per surface is how two
// products end up disagreeing about what a .pptx looks like.
//
// The dependency is OPTIONAL. Where it is absent the extension is drawn as a plain badge rather
// than nothing, because a file with no glyph still needs to be identifiable.
import { useEffect, useState } from 'react';

export function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

let mod = null;         // { FileIcon, defaultStyles } once resolved
let tried = false;

export function FileTypeIcon({ name, size = 36 }) {
  const [, force] = useState(0);
  const ext = extOf(name);

  useEffect(() => {
    if (tried || mod) return;
    tried = true;
    import('react-file-icon')
      .then((m) => { mod = m; force((n) => n + 1); })
      .catch(() => { /* not installed; the badge below is the answer */ });
  }, []);

  const box = { width: size, height: Math.round(size * 1.16), display: 'inline-block', flex: '0 0 auto' };

  if (!mod) {
    return (
      <span className="uic-fileglyph" style={box} aria-hidden="true">
        <span className="uic-fileglyph-ext">{(ext || 'file').slice(0, 4)}</span>
      </span>
    );
  }
  const { FileIcon, defaultStyles } = mod;
  const style = defaultStyles?.[ext] || {};
  return (
    <span style={box}>
      <FileIcon extension={ext || undefined} {...style} />
    </span>
  );
}
