// useTypewriter — cycle example prompts through a placeholder, typed out character by character.
//
// Three near-identical implementations existed; the differences between them were 24ms vs 26ms
// per character and whether the list was shuffled. Those are not configuration, they are drift,
// so there are no knobs for them here.
//
// The part worth sharing is the one thing all three already got right and nobody should have to
// re-derive: prefers-reduced-motion turns the animation off and shows the first phrase, because
// text that rewrites itself forever is exactly what that setting is about.
import { useEffect, useRef, useState } from 'react';

const CHAR_MS = 26;    // per character while typing
const HOLD_MS = 2600;  // a finished phrase stays long enough to read

/**
 * phrases  the lines to cycle (the product's own copy — it stays in the product)
 * active   type only while this is true; a box the person is typing in stops animating
 * returns  the text to show right now
 */
export function useTypewriter(phrases, { active = true } = {}) {
  const list = phrases && phrases.length ? phrases : [''];
  const [text, setText] = useState(list[0]);
  // Snapshot the list so a caller passing a fresh array literal every render does not restart
  // the animation on every render.
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      setText(listRef.current[0]);
      return undefined;
    }
    let i = 0;
    let pos = 0;
    let timer;
    const tick = () => {
      const cur = listRef.current[i % listRef.current.length];
      if (pos <= cur.length) {
        setText(cur.slice(0, pos));
        pos += 1;
        timer = window.setTimeout(tick, CHAR_MS);
      } else {
        timer = window.setTimeout(() => { i += 1; pos = 0; tick(); }, HOLD_MS);
      }
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [active]);

  return text;
}
