// Carousel — a horizontal strip of cards with edge buttons.
//
// It exists as a component rather than as a stylesheet plus a div because the parts that were
// wrong in the copies are all behaviour, not paint: the buttons must disable at each end, must
// not be there at all when everything already fits, and must scroll by an amount related to the
// viewport. Four landings each hardcoded `scrollBy({ left: ±560 })` — the same magic number, in
// four files, correct at no particular width.
//
// Item width is a custom property (--uic-car-item, default 236px) so a product sets the card size
// from its own stylesheet without this component knowing what a card is.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Chevron } from './icons.jsx';

/**
 * label   what this strip is, for the scroll region and the button names ("Scroll <label> left")
 * step    px per press; defaults to 90% of the visible width, so a press always leaves a
 *         landmark from the previous screenful on screen
 */
export function Carousel(props) {
  const { label, step, children, classNames = {} } = props;
  const ref = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true, overflow: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth > 1;
    setEdges({
      overflow,
      start: el.scrollLeft <= 1,
      end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    measure();
    // Content arrives asynchronously (templates fetched after mount) and the container resizes
    // with the window, so "does this overflow" has to be answered again, not once.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    for (const child of el.children) ro?.observe(child);
    return () => ro?.disconnect();
  }, [measure, children]);

  const scroll = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * (step || Math.round(el.clientWidth * 0.9)), behavior: 'smooth' });
  };

  return (
    <div className={['uic-carousel-wrap', classNames.root || ''].filter(Boolean).join(' ')}>
      {edges.overflow ? (
        <button type="button" className={['uic-carousel-nav is-left', classNames.button || ''].filter(Boolean).join(' ')}
                onClick={() => scroll(-1)} disabled={edges.start} aria-label={`Scroll ${label} left`}>
          <Chevron dir="left" />
        </button>
      ) : null}
      <div className={['uic-carousel', classNames.viewport || ''].filter(Boolean).join(' ')}
           ref={ref} onScroll={measure} role="group" aria-label={label}>
        {children}
      </div>
      {edges.overflow ? (
        <button type="button" className={['uic-carousel-nav is-right', classNames.button || ''].filter(Boolean).join(' ')}
                onClick={() => scroll(1)} disabled={edges.end} aria-label={`Scroll ${label} right`}>
          <Chevron dir="right" />
        </button>
      ) : null}
    </div>
  );
}
