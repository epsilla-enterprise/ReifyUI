import { useCallback, useEffect, useRef, useState } from 'react';
import { chartTokens } from './tokens.js';

/**
 * chartTokens(), re-read when the theme changes.
 *
 * A chart's colours are baked into its option at build time, so flipping light↔dark leaves every
 * chart on the page painted for the theme that is gone until something re-renders it. There is no
 * event for "the tokens changed", so this watches the two things that change them: the attributes
 * a theme is switched with (a class or data-* on <html>/<body>), and the OS preference.
 *
 * Returns [tokens, ref] — put the ref on the element the chart lives in, or leave it unused and
 * the document's own tokens are read.
 */
export function useChartTokens() {
  const ref = useRef(null);
  const [tokens, setTokens] = useState(() => chartTokens(null));
  const reread = useCallback(() => setTokens(chartTokens(ref.current)), []);

  useEffect(() => {
    reread();
    if (typeof MutationObserver !== 'function') return undefined;
    const obs = new MutationObserver(reread);
    const opts = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };
    obs.observe(document.documentElement, opts);
    if (document.body) obs.observe(document.body, opts);
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener?.('change', reread);
    return () => { obs.disconnect(); mq?.removeEventListener?.('change', reread); };
  }, [reread]);

  return [tokens, ref];
}
