// The chart entry — IMPORT VIA SUBPATH ONLY ('reifyui/chart'), never from the root index.
//
// echarts is an optional peer and loads lazily inside Chart. A root re-export would put it in the
// dependency graph of every consumer, so an app that renders a Button and no chart would have to
// resolve a charting library to build. Same rule, same reason, as 'reifyui/slides'.
export { Chart } from './Chart.jsx';
// The theme as strings a chart option can hold — series colours, axis ink, tooltip chrome. CSS
// variables do not reach inside a canvas; these do.
export { chartTokens } from './tokens.js';
export { useChartTokens } from './useChartTokens.js';
