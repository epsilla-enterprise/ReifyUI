// Chart — an ECharts option, drawn. That is the whole component.
//
// It deliberately knows nothing about series, axes or data shape: the option IS the contract, so
// anything ECharts can draw, this draws, and the thing that decides what a chart should look like
// (a person, or an agent writing the option) is not limited by a props table. What it does own is
// the part every hand-rolled wrapper gets wrong: creating the instance once, disposing it on
// unmount, and resizing it when its box changes — a chart inside a resizable panel that never
// hears about the resize is the most common broken dashboard there is.
//
// echarts is an OPTIONAL peer, loaded lazily here, which is why this lives at `reifyui/chart` and
// not in the root index — the same reason `reifyui/slides` is its own entry. An app that imports
// a Button must not resolve a charting library.
import { useEffect, useRef, useState } from 'react';

/**
 * option    the ECharts option. Applied whenever the REFERENCE changes, so build it in a
 *           useMemo — a fresh object every render redraws the chart every render
 * renderer  'canvas' (default) or 'svg'; svg stays crisp when the page is printed or scaled
 * notMerge  replace the previous option rather than merging into it (default true: a redraw
 *           after new data should not inherit last query's series)
 * onInit    the instance, once, for the things only the instance can do (export an image)
 * label     the chart's accessible name; a canvas has no text for a screen reader to find
 * fallback  drawn instead when the chart code cannot be loaded at all
 */
export function Chart(props) {
  const { option, renderer = 'canvas', notMerge = true, onInit, label, fallback = null, className = '' } = props;
  const host = useRef(null);
  const inst = useRef(null);
  const applied = useRef(null);          // the option the instance is currently showing
  const [failed, setFailed] = useState(false);
  // Read through refs inside the init effect so a new option or callback does not tear the
  // instance down and rebuild it.
  const latest = useRef({ option, notMerge, onInit });
  latest.current = { option, notMerge, onInit };

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const mod = await import('echarts');
        const echarts = typeof mod.init === 'function' ? mod : (mod.default || mod);
        if (dead || !host.current) return;
        const chart = echarts.init(host.current, null, { renderer });
        inst.current = chart;
        const { option: opt, notMerge: nm, onInit: cb } = latest.current;
        if (opt) { chart.setOption(opt, nm); applied.current = opt; }
        if (cb) cb(chart);
      } catch {
        if (!dead) setFailed(true);          // no chart code: say so, never draw a fake one
      }
    })();
    return () => {
      dead = true;
      try { inst.current?.dispose(); } catch { /* already gone with the DOM */ }
      inst.current = null;
      applied.current = null;
    };
  }, [renderer]);

  // `applied` keeps this from redrawing the option the init above just drew — the instance
  // arrives asynchronously, so both paths run on the first render that has one.
  useEffect(() => {
    if (!inst.current || !option || applied.current === option) return;
    inst.current.setOption(option, notMerge);
    applied.current = option;
  }, [option, notMerge]);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      // One resize per frame: a drag on a panel corner fires the observer on every pointer move.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => inst.current?.resize());
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);

  if (failed) return <div className={['uic-chart', 'is-unavailable', className].filter(Boolean).join(' ')}>{fallback}</div>;
  return (
    <div
      ref={host}
      className={['uic-chart', className].filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
}
