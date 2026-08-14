// Card — art on top, a title row underneath, optional overlay and actions.
//
// The structure is the point. Every copy of this made the whole card a <button> and then put
// more buttons inside it (a preview eye, rename, delete): interactive elements nested inside an
// interactive element, which no assistive technology can present and which browsers resolve by
// guessing. Here the root is a plain div, the primary action is ONE button covering art + title,
// and `overlay` / `actions` are its siblings.
//
// `title` takes a node so an inline rename field can live there — pass onClick={undefined} while
// editing, so the row is not simultaneously a text field and a link to somewhere else.
import React from 'react';

/**
 * art        the thumbnail node (this component gives it a box; what goes in it is yours)
 * title      the name (node)
 * subtitle   quiet trailing text, e.g. when it was last opened
 * onClick    opens the thing; omit for a card that is only a display
 * selected   this card is the current choice
 * overlay    floats over the art on hover, and is ALWAYS visible on touch/narrow (there is no
 *            hover to reveal it with)
 * actions    sits in the title row, after the subtitle
 */
export function Card(props) {
  const { art, title, subtitle, onClick, selected = false, overlay, actions, classNames = {} } = props;
  const foot = (
    <span className="uic-card-foot">
      <span className="uic-card-name">{title}</span>
      {subtitle ? <span className="uic-card-sub">{subtitle}</span> : null}
    </span>
  );
  return (
    <div className={['uic-card', selected ? 'is-selected' : '', classNames.root || '']
      .filter(Boolean).join(' ')}>
      {onClick ? (
        <button type="button" className="uic-card-main" onClick={onClick} aria-pressed={selected || undefined}>
          <span className="uic-card-art">{art}</span>
          {foot}
        </button>
      ) : (
        <div className="uic-card-main">
          <span className="uic-card-art">{art}</span>
          {foot}
        </div>
      )}
      {overlay ? <div className="uic-card-overlay">{overlay}</div> : null}
      {actions ? <div className="uic-card-actions">{actions}</div> : null}
    </div>
  );
}
