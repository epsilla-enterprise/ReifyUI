// reifyui/sheet — public type surface (hand-authored; the source is plain-ESM React).
import type { ComponentType } from 'react';
import type * as doc from './doc';

export { SheetGrid, sheetToDelimited, sheetToAoA } from '../index';
export type SheetOp = doc.SheetOp;
export interface SheetCollab {
  /** The sheet as plain data, re-derived on every remote change. */
  sheet: Record<string, unknown> | null;
  /** Apply ops to the live document (the only way anyone writes). */
  ops(ops: SheetOp[]): void;
  peers: Array<Record<string, unknown>>;
  setPresence(presence: Record<string, unknown> | null): void;
  [k: string]: unknown;
}
export function useSheetCollab(options: Record<string, unknown>): SheetCollab;
export const sheetOps: Record<string, (...args: any[]) => SheetOp>;
export function useSheetRun(options: Record<string, unknown>): Record<string, unknown>;
export function withQueuedCells(sheet: Record<string, unknown>, run: Record<string, unknown>): Record<string, unknown>;
export function runProgress(run: Record<string, unknown>): { done: number; total: number; [k: string]: unknown };
export function isRunActive(run: Record<string, unknown> | null | undefined): boolean;
export const RunStrip: ComponentType<Record<string, unknown>>;
export const sheetDoc: typeof doc;
