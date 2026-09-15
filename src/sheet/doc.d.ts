// reifyui/sheet-doc — the sheet document family, React-free: a sidecar service applies the
// same ops the browsers apply, so one module is the truth of what a sheet document holds.
import type * as Y from 'yjs';

export interface SheetOp { op: string; [k: string]: unknown; }
/** Collaboration document names of sheets carry this prefix. */
export const SHEET_PREFIX: string;
export function isSheetDoc(name: unknown): boolean;
export function sheetIdOf(name: string): string;
export function orderOf(order: unknown, map: unknown): string[];
/** Seed an empty document from the owner's stored sheet. */
export function seed(doc: Y.Doc, sheet: Record<string, unknown>, origin?: string): void;
/** The sheet as plain data. */
export function toJSON(doc: Y.Doc): Record<string, unknown>;
/** Apply content ops (set_cell, set_column, move_row, set_tab, replace, ...) to the live document. */
export function apply(doc: Y.Doc, ops: SheetOp[], origin?: string): void;
