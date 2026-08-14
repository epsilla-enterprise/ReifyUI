// Type declarations for `reifyui/chart`.
//
// Hand-authored, like the root index: the source is plain JSX, so there is nothing to infer from.
// The option type is deliberately open — it is ECharts' own object, and narrowing it here would
// only describe the subset that existed the day this was written.
import type { ComponentType, ReactNode, RefObject } from 'react';

/** An ECharts option object. Typed as-is: install echarts and annotate your own builders with
 *  `EChartsOption` if you want the full shape checked at the call site. */
export type ChartOption = Record<string, unknown>;

export interface ChartProps {
  /** Applied whenever the REFERENCE changes — build it in a useMemo, or the chart redraws on
   *  every render of the parent. */
  option: ChartOption;
  /** 'svg' stays crisp when the page is printed or scaled; 'canvas' (default) draws faster. */
  renderer?: 'canvas' | 'svg';
  /** Replace the previous option rather than merge into it. Default true. */
  notMerge?: boolean;
  /** The instance, once — for what only the instance can do (getDataURL, connect, …). */
  onInit?: (instance: any) => void;
  /** The chart's accessible name. A canvas has no text for a screen reader to find. */
  label?: string;
  /** Drawn instead when the chart code cannot be loaded at all. */
  fallback?: ReactNode;
  className?: string;
}
/** Renders an ECharts option and nothing else: it creates the instance, disposes it, and resizes
 *  it with its box. Fills its container, so give it one with a height. */
export const Chart: ComponentType<ChartProps>;

/** The --uic-* theme, as strings a chart option can hold. */
export interface ChartTokens {
  /** Eight categorical colours. Assign IN ORDER, one per series, and never cycle: past eight,
   *  colour has stopped encoding identity — fold the tail into one series or split the chart.
   *  On a light surface three of the eight fall below 3:1 against white, so keep the legend or
   *  label series directly rather than resting identity on colour alone. */
  palette: string[];
  ink: string;
  ink2: string;
  mute: string;
  line: string;
  lineSoft: string;
  surface: string;
  brand: string;
  ok: string;
  warn: string;
  bad: string;
  font: string;
}
/** Resolve the tokens in effect for `el` — pass the element the chart lives in, so a panel inside
 *  a dark region resolves the dark values even on a light page. */
export function chartTokens(el?: Element | null): ChartTokens;

/** chartTokens(), re-read when the theme changes (a class/data-* flip on <html> or <body>, or the
 *  OS preference). Put the returned ref on the element the chart lives in. */
export function useChartTokens(): [ChartTokens, RefObject<HTMLElement | null>];
