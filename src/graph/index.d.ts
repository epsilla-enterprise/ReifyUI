// reifyui/graph — public type surface (hand-authored; the source is plain-ESM React).
import type { ComponentType, ReactNode } from 'react';

/** Everything the panes ask a host for, bound to the host's API base and auth. */
export interface GraphClient {
  getConnect(graphId: string): Promise<unknown>;
  putConnect(graphId: string, registry: unknown): Promise<unknown>;
  testConnectTool(graphId: string, tool: string, args: Record<string, unknown>): Promise<unknown>;
  listConnectKeys(graphId: string): Promise<unknown[]>;
  createConnectKey(graphId: string, name: string): Promise<unknown>;
  revokeConnectKey(graphId: string, keyId: string): Promise<unknown>;
  fetchAudit(graphId: string, params: { limit?: number; cursor?: string | null; q?: string }): Promise<unknown>;
  /** Absolute URL for a gateway path (the MCP endpoint shown to the user). */
  endpointUrl(path: string): string;
}
export interface ConnectPaneProps { graphId: string; client: GraphClient; liveRegistry?: unknown; }
export interface LogsPaneProps {
  graphId: string;
  client: GraphClient;
  /** The mark shown for entries the product's own copilot wrote; a generic icon when absent. */
  copilotMark?: ReactNode;
}
export const ConnectPane: ComponentType<ConnectPaneProps>;
export const LogsPane: ComponentType<LogsPaneProps>;
export const Skeleton: ComponentType<Record<string, unknown>>;
export function fmtUnits(consumption: unknown): string | null;
export function relativeTime(ts: number | string | null | undefined): string | null;
export function absoluteTime(ts: number | string | null | undefined): string | null;
export function useGraphCollab(options: Record<string, unknown>): Record<string, unknown>;
export function materializeDraft(...args: any[]): Promise<unknown>;
export function saveDraft(...args: any[]): Promise<unknown>;
/** Configure the graph transport once at boot: (path, init) => Promise<Response-like>. */
export function configureVgraph(transport: (...args: any[]) => Promise<unknown>): void;
export const vgraph: Record<string, (...args: any[]) => Promise<unknown>>;
export const DATA_TYPES: readonly string[];
export function parseAssetRef(ref: string): unknown;
export function schemaVersionNum(v: unknown): number;
export function semanticDimsFor(propName: string): number;
export function semanticIndexFor(propName: string, dims?: number): unknown;
export function semanticIndexOn(type: unknown, propName: string): unknown;
export function pollSchemaChange(...args: any[]): Promise<unknown>;
