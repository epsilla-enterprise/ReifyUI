// ReifyUI public type surface.
//
// The implementation is plain-ESM React (.js/.jsx), so these declarations are
// authored by hand rather than inferred. Components accept the props documented in
// the README; where a prop set is open-ended (render slots, passthrough) the type is
// intentionally permissive rather than falsely precise.
import type { ComponentType, ReactNode } from 'react';

// ── streaming ──────────────────────────────────────────────────────────────
export interface SSEEvent { type: string; [k: string]: unknown; }

/** Semantic callbacks over the Responses SSE shape. All optional — handle only what you render. */
export interface ResponseHandlers {
  /** The response id, as soon as response.created arrives. */
  onCreated?(responseId: string): void;
  /** The server-side session id, for continuing this conversation on the next turn. */
  onSession?(sessionId: string): void;
  onReasoningDelta?(text: string): void;
  onTextDelta?(text: string): void;
  onToolCall?(name: string, args: string, callId: string): void;
  onToolResult?(callId: string, output: string): void;
  onFile?(file: { container_id: string; file_id: string; filename: string }): void;
  /** Terminal event. `status` distinguishes completed / incomplete / failed (incl. cancels). */
  onDone?(status: string, response: unknown): void;
  onError?(message: string): void;
}

export interface ResponsesDispatcher {
  responseId: string | null;
  dispatch(event: SSEEvent): void;
}
/** Event-shape decoding only — pair with readSSEStream when you own the read loop. */
export function createResponsesDispatcher(handlers: ResponseHandlers): ResponsesDispatcher;

/** Parse an SSE byte stream into events. Takes the response BODY, not the Response. */
export function readSSEStream(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (event: SSEEvent) => void,
): Promise<void>;

/** Read + decode in one call. Resolves to the response id. */
export function pumpResponsesStream(
  body: ReadableStream<Uint8Array> | null,
  handlers: ResponseHandlers,
): Promise<string | null>;

// ── block state machine ─────────────────────────────────────────────────────
// These are pass-through array transforms: they append to, or amend the tail of, whatever block
// shape the caller already uses. Generic over that shape so an app with its own discriminated
// Block union keeps it, instead of having every result widened to a bag of unknowns.
export type Block = Record<string, unknown>;
export function withText<B = Block>(blocks: B[], text: string): B[];
export function withReasoning<B = Block>(blocks: B[], text: string): B[];
export function withStep<B = Block>(blocks: B[], step: Record<string, unknown>): B[];
/** Attach a tool result to the step with this call id. */
export function withResult<B = Block>(blocks: B[], callId: string, output: unknown): B[];
export function asstText<B = Block>(blocks: B[]): string;

// ── conversation store ──────────────────────────────────────────────────────
// A tiny keyed store with a React binding: `use(key)` subscribes, `get`/`set` read and write
// outside render. Values are whatever the caller puts in, so they stay generic per key.
export interface ConversationStore {
  get<T = unknown>(key: string): T;
  set<T = unknown>(key: string, next: T | ((prev: T) => T)): void;
  seed(key: string, value: unknown): void;
  updateLastAssistant(key: string, update: (msg: unknown) => unknown): void;
  use<T = unknown>(key: string): T;
}
/** `makeInitial(key)` supplies the starting value the first time a key is read. */
export function createConversationStore(
  makeInitial?: (key: string) => unknown,
): ConversationStore;

// ── icons ───────────────────────────────────────────────────────────────────
export const Svg: ComponentType<{ s?: number; children?: ReactNode }>;
export const Chevron: ComponentType<{ dir?: 'left' | 'right' | 'down'; size?: number }>;
export const IcTool: ComponentType;
export const IcPlug: ComponentType;
export const IcSkill: ComponentType;
export const IcTerminal: ComponentType;
export const IcDoc: ComponentType;
export const IcList: ComponentType;
export const IcGlobe: ComponentType;
export const IcSearch: ComponentType;
export const IcScroll: ComponentType;
export const IcSpawn: ComponentType;
export const IcCheck: ComponentType;
export const IcThink: ComponentType;
export const IcSend: ComponentType;

// ── tool metadata helpers ─────────────────────────────────────────────────────
export function humanize(name: string): string;
export function parseArgs(raw: unknown): Record<string, unknown>;
export function baseName(path: string): string;
export function prettyJson(value: unknown): string;
export function toolMeta(name: string): { label: string; icon?: ComponentType; [k: string]: unknown };
export function summarizeSteps(steps: unknown[]): string;

// ── components (permissive props: see README for slot contracts) ─────────────
export const ToolGroup: ComponentType<Record<string, unknown>>;
export const ToolRow: ComponentType<Record<string, unknown>>;
/** The message list. `messages` is the conversation you own — this renders it and its tool
 *  timeline; every render slot is optional. */
export interface ChatMessagesProps {
  messages: unknown[];
  renderMarkdown?: (text: string) => ReactNode;
  renderMessage?: (message: unknown, index: number) => ReactNode;
  renderStep?: (step: unknown) => ReactNode;
  userExtras?: (message: unknown) => ReactNode;
  workingExtra?: ReactNode;
  assistantFooter?: (message: unknown, index: number) => ReactNode;
  statusLabels?: Record<string, string>;
  workingLabel?: string;
  toolLabels?: Record<string, string>;
  [k: string]: unknown;
}
export const ChatMessages: ComponentType<ChatMessagesProps>;
export const ChatMessagesSkeleton: ComponentType<Record<string, unknown>>;
export const UserTurn: ComponentType<Record<string, unknown>>;
export const AssistantTurn: ComponentType<Record<string, unknown>>;
export const DEFAULT_STATUS_LABELS: Record<string, string>;
export const Composer: ComponentType<Record<string, unknown>>;
export const CodeBlock: ComponentType<{ code?: string; lang?: string; [k: string]: unknown }>;

// ── resizable pane ──────────────────────────────────────────────────────────
export function useResizablePane(options?: Record<string, unknown>): {
  size: number;
  setSize: (n: number) => void;
  [k: string]: unknown;
};
export const PaneResizer: ComponentType<Record<string, unknown>>;

// ── task list ───────────────────────────────────────────────────────────────
export interface TaskListPage { items: unknown[]; cursor?: string; }
export interface TaskListProps {
  fetchPage: (cursor: string) => Promise<TaskListPage> | TaskListPage;
  selected?: string | null;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  onDelete?: (item: any) => void;
  header?: ReactNode;
  renderMeta?: (item: any) => ReactNode;
  refreshNonce?: number;
  emptyLabel?: string;
  newLabel?: string;
  idKey?: string; titleKey?: string; statusKey?: string; timeKey?: string;
}
export const TaskList: ComponentType<TaskListProps>;
export function taskStatusGroup(status: string): 'working' | 'done' | 'failed' | 'idle';

// ── dialogs (alert / confirm / prompt, in-app) ───────────────────────────────
export type DialogVariant = 'destructive' | 'error' | 'warning' | 'success';
export interface DialogLabels {
  confirm?: string; cancel?: string; ok?: string; create?: string; required?: string;
}
export interface AlertOptions {
  title?: string; message?: ReactNode; variant?: DialogVariant; confirmLabel?: string;
}
export interface ConfirmOptions extends AlertOptions {
  destructive?: boolean; cancelLabel?: string;
}
export interface PromptOptions extends ConfirmOptions {
  label?: string; placeholder?: string; help?: ReactNode;
  defaultValue?: string; inputType?: string;
  multiline?: boolean; rows?: number; required?: boolean;
  /** Return an error message to reject, or null/undefined to accept. */
  validate?: (value: string) => string | null | undefined;
}
export interface CreateType { kind: string; label: string; color?: string; icon?: ReactNode; }
export interface CreateOptions extends PromptOptions {
  types?: CreateType[]; defaultKind?: string;
}
export interface DialogApi {
  alert(opts: AlertOptions): Promise<boolean>;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** Resolves to the entered string, or null when cancelled. */
  prompt(opts: PromptOptions): Promise<string | null>;
  create(opts: CreateOptions): Promise<{ kind: string; name: string } | null>;
  labels: Required<DialogLabels>;
}
export const DialogHost: ComponentType<{
  children?: ReactNode; locale?: 'en' | 'zh'; labels?: DialogLabels;
}>;
export function useDialog(): DialogApi;

// ── auth client (optional; couples to a /v1/auth-style backend) ──────────────
export interface AuthConfig { engine: string; product: string; loginHash?: string; }
export function configureAuth(cfg: Partial<AuthConfig> & { product: string; engine: string }): void;
export function authConfig(): AuthConfig;
export const SESSION_EVENT: string;
export function getSession(): unknown | null;
export function clearSession(): void;
export function getToken(): string | null;
export function isAuthed(): boolean;
export function login(email: string, password: string): Promise<unknown>;
export function register(payload: Record<string, unknown>): Promise<unknown>;
export function googleSignIn(credential: string, extra?: Record<string, unknown>): Promise<unknown>;
export function requestPasswordReset(email: string): Promise<unknown>;
export function switchOrg(orgId: string): Promise<unknown>;
export function refreshToken(): Promise<unknown>;
export function handleAuthExpired(): void;
export function logout(): void;
export function authFetch(input: string, init?: RequestInit): Promise<Response>;
export function fetchBalance(): Promise<unknown>;
export const AuthForm: ComponentType<Record<string, unknown>>;
export const GoogleButton: ComponentType<Record<string, unknown>>;
export const GOOGLE_ENABLED: boolean;

// ── AI spreadsheet grid ──────────────────────────────────────────────────────
export const SheetGrid: ComponentType<Record<string, unknown>>;
export function sheetToDelimited(sheet: unknown, delimiter?: string): string;
export function sheetToAoA(sheet: unknown): unknown[][];
