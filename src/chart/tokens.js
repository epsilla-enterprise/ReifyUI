// The theme, as values a chart library can use.
//
// A chart draws into a canvas, where CSS custom properties do not reach: series colours, axis
// labels and tooltip chrome all arrive as strings in an option object. Without this, every app
// hardcodes hex in its chart code and the charts are the one part of the product that does not
// follow the theme. Reading the same --uic-* tokens the stylesheets read keeps them together.

// Same policy as the `var(--uic-x, …)` fallbacks in the stylesheets: a host that never loaded a
// token layer still gets the library's own light palette rather than whatever the chart library
// defaults to. Values are themes/light.css verbatim.
const FALLBACK = {
  cat: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  ink: '#111317', ink2: '#3A3D45', mute: '#5B5D66',
  line: '#DDDFE6', lineSoft: '#EFF1F4', surface: '#FFFFFF',
  brand: '#285AFF', ok: '#16a34a', warn: '#F59E0B', bad: '#b91c1c',
  font: 'inherit',
};

function read(style, name, fallback) {
  const v = style.getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Resolve the chart tokens in effect for `el` — pass the element the chart lives in, so a panel
 * inside a dark region resolves the dark values even when the page is light.
 *
 * `palette` is a categorical scale: assign it IN ORDER, one colour per series, and never cycle
 * it. Past eight series, colour has stopped being an encoding — fold the tail into one "other"
 * series or split the chart. On a light surface three of the eight sit below 3:1 against white,
 * so identity must not rest on colour alone: keep the legend, or label the series directly.
 */
export function chartTokens(el) {
  const target = (el && el.nodeType === 1 ? el : null)
    || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target || typeof getComputedStyle !== 'function') return { ...FALLBACK, palette: FALLBACK.cat };
  const s = getComputedStyle(target);
  return {
    palette: FALLBACK.cat.map((hex, i) => read(s, `--uic-cat-${i + 1}`, hex)),
    ink: read(s, '--uic-ink', FALLBACK.ink),
    ink2: read(s, '--uic-ink-2', FALLBACK.ink2),
    mute: read(s, '--uic-mute', FALLBACK.mute),
    line: read(s, '--uic-line', FALLBACK.line),
    lineSoft: read(s, '--uic-line-soft', FALLBACK.lineSoft),
    surface: read(s, '--uic-surface', FALLBACK.surface),
    brand: read(s, '--uic-brand', FALLBACK.brand),
    ok: read(s, '--uic-ok', FALLBACK.ok),
    warn: read(s, '--uic-warn', FALLBACK.warn),
    bad: read(s, '--uic-fail-ink', FALLBACK.bad),
    font: read(s, '--uic-font', FALLBACK.font),
  };
}
