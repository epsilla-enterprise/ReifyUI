// CascadeMenu — a two-level choice in one panel. The first column lists the things you can pick;
// the second lists the options of the one you pressed or arrowed onto; a press in the second
// column IS the pick. A menu with a submenu, laid flat: both levels stay visible, so
// nothing has to be hovered just right to stay open, and the reader sees "harness, then model"
// as one gesture instead of a modal with a filter, a list, and a second control afterwards.
//
// It rides on Popover, so it portals to the body, flips to the side with room, clamps to the
// viewport and scrolls inside the height it was given — the panel never runs off the screen.
// Under `stackBelow` px of viewport the two columns cannot sit side by side, so the same panel
// walks them as steps: pick in the first, the second replaces it with a way back.
//
// Choosing in the first column is a press or a focus, NOT a hover. A hover-driven second column
// is the classic submenu trap: the pointer crossing other rows on its diagonal way to an option
// swaps the options out from under it. Here the first column changes only on click or on
// keyboard focus, so the path to an option is never a race.
//
// Keyboard: ↑↓ move within a column, → enters the options of the chosen item, ← returns to it,
// Enter/Space press (native buttons), Escape closes (Popover). Focus lands inside on open and
// goes back to the anchor on close.
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from './Popover.jsx';
import { SearchField } from './SearchField.jsx';
import { Chevron, Svg } from './icons.jsx';

const Tick = () => <Svg s={14}><path d="M20 6 9 17l-5-5" /></Svg>;

const FILTER_PAST = 8; // 'auto': a filter field appears once the first column is longer than this

const itemsOf = (groups) => groups.flatMap((g) => g.items);

/**
 * open, anchorRef, onClose   as Popover
 * label              accessible name of the panel
 * groups             [{ label, items: [{ id, label, icon, note }] }] — the first column, grouped;
 *                    a note is a small trailing word, e.g. 'fixed' on the one item a locked
 *                    chooser offers
 * optionsOf(item)    -> [{ id, label, disabled, note }] — the second column for one item
 * onPick(item, option)
 * value              { item, option } — the current pair: its item opens first and its option
 *                    carries a check, so an editor of an existing choice shows where it stands
 * filter             'auto' (default) | true | false — a filter field over the first column
 * filterPlaceholder  default 'Filter'
 * emptyText          first column has no match; noOptionsText: the item offers nothing
 * optionsLabel       accessible name of the second column, default 'Options'
 * backLabel          the way back in stacked mode, default 'Back'
 * width              side-by-side width, default 520; stackBelow: viewport px, default 560
 */
export function CascadeMenu(props) {
  const {
    open, anchorRef, onClose, label,
    groups = [], optionsOf, onPick,
    filter = 'auto', filterPlaceholder = 'Filter',
    emptyText = 'Nothing matches.', noOptionsText = 'Nothing to choose here.',
    optionsLabel = 'Options', backLabel = 'Back',
    width = 520, stackBelow = 560, className, value,
  } = props;

  const rootRef = useRef(null);
  const [q, setQ] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [stage, setStage] = useState('items');
  const [stacked, setStacked] = useState(false);

  // Filtering happens on the label people read, nothing else.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return groups.filter((g) => g.items.length > 0);
    return groups
      .map((g) => ({ ...g, items: g.items.filter((it) => String(it.label).toLowerCase().includes(needle)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);
  const flat = useMemo(() => itemsOf(visible), [visible]);
  const active = flat.find((it) => it.id === activeId) || flat[0] || null;
  const options = useMemo(() => (active && optionsOf ? optionsOf(active) : []), [active, optionsOf]);
  const showFilter = filter === true || (filter === 'auto' && itemsOf(groups).length > FILTER_PAST);

  // Fresh every time it opens: no stale filter, the first item highlighted, the first step shown.
  useEffect(() => {
    if (!open) return undefined;
    setQ(''); setActiveId(value?.item ?? null); setStage('items');
    const measure = () => setStacked(window.innerWidth < stackBelow);
    measure();
    window.addEventListener('resize', measure);
    // Popover renders its children one effect later (it has to measure the anchor first), so the
    // first focusable lands in the next frame.
    const raf = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector('input, button:not(:disabled)');
      first?.focus({ preventScroll: true });
    });
    const anchor = anchorRef?.current;
    return () => {
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(raf);
      // Close by Escape or by a pick: focus goes back where it came from. Close by a press
      // elsewhere: the browser moves focus to that press afterwards, so this does not fight it.
      anchor?.focus?.({ preventScroll: true });
    };
  }, [open, stackBelow]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusIn = useCallback((col, index = 0) => {
    const list = rootRef.current?.querySelectorAll(`.uic-cascade-${col} .uic-pop-item:not(:disabled)`);
    if (!list || !list.length) return false;
    const i = Math.max(0, Math.min(index, list.length - 1));
    list[i].focus({ preventScroll: true });
    return true;
  }, []);

  const enterOptions = useCallback(() => {
    if (stacked) { setStage('options'); requestAnimationFrame(() => focusIn('options')); }
    else focusIn('options');
  }, [stacked, focusIn]);

  const onKey = (e) => {
    const el = document.activeElement;
    const col = el?.closest?.('.uic-cascade-col');
    const inItems = col?.classList.contains('uic-cascade-items');
    const inOptions = col?.classList.contains('uic-cascade-options');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!col) return;
      const list = Array.from(col.querySelectorAll('.uic-pop-item:not(:disabled)'));
      const i = list.indexOf(el);
      // From the filter field, ↓ steps onto the first row.
      const next = i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1);
      if (next < 0) { col.querySelector('input')?.focus(); e.preventDefault(); return; }
      if (next >= list.length) return;
      e.preventDefault();
      list[next].focus({ preventScroll: true });
    } else if (e.key === 'ArrowRight' && inItems) {
      e.preventDefault(); enterOptions();
    } else if (e.key === 'ArrowLeft' && inOptions) {
      e.preventDefault();
      if (stacked) { setStage('items'); requestAnimationFrame(() => focusIn('items', flat.indexOf(active))); }
      else focusIn('items', flat.indexOf(active));
    } else if (e.key === 'Enter' && el?.tagName === 'INPUT') {
      // Enter in the filter means "this one": on to its options.
      e.preventDefault(); enterOptions();
    }
  };

  const showItems = !stacked || stage === 'items';
  const showOptions = !stacked || stage === 'options';

  return (
    <Popover open={open} anchorRef={anchorRef} onClose={onClose} label={label}
             width={stacked ? 320 : width} minHeight={260}
             className={['uic-cascade-pop', className || ''].filter(Boolean).join(' ')}>
      <div ref={rootRef} className={'uic-cascade' + (stacked ? ' is-stacked' : '')} onKeyDown={onKey}>
        {showItems && (
          <div className="uic-cascade-col uic-cascade-items">
            {showFilter ? (
              <SearchField className="uic-cascade-filter" value={q} onChange={setQ} placeholder={filterPlaceholder} />
            ) : null}
            <div className="uic-pop-list">
              {visible.map((g, gi) => (
                <Fragment key={g.label || gi}>
                  {g.label ? <div className="uic-cascade-group">{g.label}</div> : null}
                  {g.items.map((it) => {
                    const on = active?.id === it.id;
                    return (
                      <button key={it.id} type="button"
                        className={'uic-pop-item uic-cascade-item' + (on ? ' is-active' : '')}
                        aria-expanded={on} aria-haspopup="true"
                        onFocus={() => setActiveId(it.id)}
                        onClick={() => { setActiveId(it.id); enterOptions(); }}>
                        {it.icon ? <span className="uic-cascade-ic" aria-hidden="true">{it.icon}</span> : null}
                        <span className="uic-chip-t">{it.label}</span>
                        {it.note ? <span className="uic-cascade-note">{it.note}</span> : null}
                        <span className="uic-cascade-chev" aria-hidden="true"><Chevron dir="right" size={14} /></span>
                      </button>
                    );
                  })}
                </Fragment>
              ))}
              {flat.length === 0 ? <div className="uic-pop-note">{emptyText}</div> : null}
            </div>
          </div>
        )}
        {showOptions && (
          <div className="uic-cascade-col uic-cascade-options" role="group" aria-label={optionsLabel}>
            <div className="uic-cascade-head">
              {stacked ? (
                <button type="button" className="uic-cascade-back" aria-label={backLabel}
                  onClick={() => { setStage('items'); requestAnimationFrame(() => focusIn('items', flat.indexOf(active))); }}>
                  <Chevron dir="left" size={14} />
                </button>
              ) : null}
              {active?.icon ? <span className="uic-cascade-ic" aria-hidden="true">{active.icon}</span> : null}
              <span className="uic-chip-t">{active ? active.label : ''}</span>
            </div>
            <div className="uic-pop-list">
              {options.map((o) => {
                const on = !!value && active?.id === value.item && o.id === value.option;
                return (
                <button key={o.id} type="button" className={'uic-pop-item uic-cascade-opt' + (on ? ' is-on' : '')}
                  aria-current={on ? 'true' : undefined}
                  disabled={!!o.disabled} onClick={() => onPick?.(active, o)}>
                  {value ? <span className="uic-pop-check" aria-hidden="true">{on ? <Tick /> : null}</span> : null}
                  <span className="uic-chip-t">{o.label}</span>
                  {o.note ? <span className="uic-cascade-note">{o.note}</span> : null}
                </button>
                );
              })}
              {active && options.length === 0 ? <div className="uic-pop-note">{noOptionsText}</div> : null}
            </div>
          </div>
        )}
      </div>
    </Popover>
  );
}
