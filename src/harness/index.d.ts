// reifyui/harness — the HarnessRouter transport for apps served by the HarnessRouter console.
//
// Hand-authored, like the rest of this package's types: the implementation is plain ESM.
import type { ResponseHandlers } from '../index';

export interface KitConfig {
  /** What GET /v1/harnesses reports in `kit` for the harness this kit launched. */
  kitId: string;
  /** The console's API proxy. Same-origin, so the console session authenticates every call. */
  base: string;
}
export function configureKit(config: Partial<KitConfig>): KitConfig;
export function kitConfig(): KitConfig;

/** An Error from `hr` carries the HTTP status, so callers can branch on 409 / 404. */
export interface HarnessError extends Error { status?: number }
export function hr(path: string, init?: RequestInit): Promise<any>;

export interface Harness {
  id: string;
  name: string;
  base?: string;
  defaultModel?: string;
  /** The starter kit that launched this harness, or null for a hand-made one. */
  kit?: string | null;
  additionalHeaders?: Record<string, string>;
  [key: string]: unknown;
}
export function listHarnesses(): Promise<Harness[]>;
/** Null when the kit was never launched — a real answer the caller must render. */
export function kitHarness(): Promise<Harness | null>;

export interface Session {
  id: string;
  title?: string;
  status?: string;
  turn_status?: string;
  created_at?: string | number;
  updated_at?: string | number;
  [key: string]: unknown;
}
export function listSessions(opts?: { limit?: number }): Promise<{ sessions: Session[]; cursor: string | null }>;
export function sessionDetail(sid: string): Promise<Session>;
export function patchSession(sid: string, patch: { title: string }): Promise<unknown>;
export function deleteSession(sid: string): Promise<unknown>;

/** Reads the LIVE workspace, so a file appears the moment the agent writes it. Null if absent. */
export function readFile(sid: string, path: string): Promise<string | null>;
export function readJsonFile<T = unknown>(sid: string, path: string): Promise<T | null>;
/** Refused 409 `session_busy` while that session has a turn running. Re-arm; never drop. */
export function writeFile(sid: string, path: string, content: string): Promise<unknown>;
export function containerFileUrl(containerId: string, fileId: string): string;

export interface Turn {
  user?: string;
  assistant?: string;
  status?: string;
  tools?: Array<{ name: string; arguments?: unknown; result?: unknown }>;
  [key: string]: unknown;
}
export function sessionTurns(sid: string, opts?: { limit?: number }): Promise<Turn[]>;
export function getResponse(rid: string): Promise<any>;
export function createResponse(
  body: Record<string, unknown>,
  opts?: { idempotencyKey?: string; stream?: boolean },
): Promise<any>;
export function cancelResponse(rid: string): Promise<unknown>;
export function cancelSession(sid: string): Promise<unknown>;

/** ResponseHandlers already carries onSession — a brand-new document learns its own id there. */
export type StreamTurnHandlers = ResponseHandlers;
export function streamTurn(args: {
  sessionId?: string;
  harnessId?: string;
  input: unknown;
  /** Framing goes here, never in `input`: the transcript must show the person's own words. */
  instructions?: string;
  handlers?: StreamTurnHandlers;
}): Promise<{ ok?: boolean; sessionId?: string; connecting?: boolean }>;

export interface ChatMessage {
  role: 'user' | 'assistant';
  text?: string;
  blocks?: Array<Record<string, unknown>>;
  status?: string;
}
/** Also exported from the package root — same function, one implementation (state/turns.js).
 *  Converting history must not require importing this fetch layer, and importing this fetch
 *  layer must not mean going somewhere else for the converter. */
export function turnsToMessages(turns: Turn[]): ChatMessage[];
export function lastAssistantText(turns: Turn[]): string;

// ── files on their way into a turn ──────────────────────────────────────────
/** Per-file cap the API enforces. A bigger file is refused by name, never truncated. */
export const FILE_MAX: number;
/** Content type from a filename's extension, for the handful the products actually send. */
export function mimeOf(name: string, fallback?: string): string;
/** ArrayBuffer -> data: URL. Chunked: one fromCharCode over a large file overflows the stack. */
export function bufferToDataUrl(buffer: ArrayBuffer, filename: string, type?: string): string;

/** A picked File -> the `input_file` block a turn takes, wrapped in ChatPanel's StagedFile shape
 *  so a whole attachment story is `attachments={{ prepare: fileToInputBlock }}`.
 *
 *  Not a workspace PUT: that needs a session a brand-new document does not have, is refused 409
 *  while a turn runs, and cannot carry bytes that are not text.
 *
 *  Rejects with a message naming the FILE when it is over the cap — the person reads it. */
export function fileToInputBlock(
  file: File,
  options?: { maxBytes?: number },
): Promise<{ name: string; size: number; payload: { type: 'input_file'; filename: string; file_data: string } }>;
