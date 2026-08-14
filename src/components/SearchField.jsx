// SearchField — the filter box that sits in a section header.
//
// Byte-identical in three apps; the fourth ships the stylesheet for it and no component, so its
// lists have no search at all. Draws the package's own glyphs, so adopting it does not drag an
// icon library into a product that had not chosen one.
import React from 'react';
import { IcSearch, IcX } from './icons.jsx';

/** placeholder doubles as the accessible name — a search box next to a heading rarely has room
 *  for a visible label, and "Search templates" is exactly what the label would have said. */
export function SearchField(props) {
  const { value, onChange, placeholder, clearLabel = 'Clear search', className } = props;
  return (
    <label className={['uic-search', className || ''].filter(Boolean).join(' ')}>
      <span className="uic-search-ic" aria-hidden="true"><IcSearch /></span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button type="button" className="uic-search-x" aria-label={clearLabel} onClick={() => onChange('')}>
          <IcX size={12} />
        </button>
      ) : null}
    </label>
  );
}
