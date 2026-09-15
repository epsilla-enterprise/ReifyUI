// reifyui/collab — public type surface (hand-authored; the source is plain-ESM React).
import type * as Y from 'yjs';

export interface LiveDocOptions {
  /** The collaboration server (Hocuspocus) URL. */
  url: string;
  /** The document name; one document per resource. */
  name: string;
  /** A bearer ticket for the document, as the host's collaboration service issues it. */
  token?: string;
  /** Called once the document is synced; `doc` is the shared Y.Doc. */
  onSynced?(doc: Y.Doc): void;
  [k: string]: unknown;
}
export interface LiveDoc {
  doc: Y.Doc | null;
  provider: unknown;
  synced: boolean;
  status: string;
  awareness: unknown;
  [k: string]: unknown;
}
/** One live-document core: provider lifecycle, sync state, awareness, for any live surface. */
export function useLiveDoc(options: LiveDocOptions | null): LiveDoc;
/** Keep awareness renewed from a worker clock so a hidden tab's presence never lapses. */
export function keepPresenceAlive(provider: unknown, periodMs?: number): () => void;
export const PEER_PALETTE: readonly string[];
/** The palette color for a peer id, stable across every host. */
export function peerColor(id: string | number): string;
export function withAlpha(color: string, alpha: number): string;
