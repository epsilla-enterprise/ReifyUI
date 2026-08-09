// ReifyUI public type surface.
//
// The implementation is plain-ESM React (.js/.jsx), so these declarations are
// authored by hand rather than inferred. Components accept the props documented in
// the README; where a prop set is open-ended (render slots, passthrough) the type is
// intentionally permissive rather than falsely precise.
import type { ComponentType, ReactNode } from 'react';

// ── streaming ──────────────────────────────────────────────────────────────
export interface SSEEvent { type: string; [k: string]: unknown; }
export function readSSEStream(
  response: Response,
  onEvent: (event: SSEEvent) => void,
): Promise<void>;
export function createResponsesDispatcher(handlers: Record<string, (event: SSEEvent) => void>):
  (event: SSEEvent) => void;
export function pumpResponsesStream(args: {
  response: Response;
  onEvent?: (event: SSEEvent) => void;
  [k: string]: unknown;
}): Promise<unknown>;

// ── block state machine ─────────────────────────────────────────────────────
export type Block = Record<string, unknown>;
export function withText(blocks: Block[], text: string): Block[];
export function withReasoning(blocks: Block[], text: string): Block[];
export function withStep(blocks: Block[], step: Record<string, unknown>): Block[];
export function withResult(blocks: Block[], result: Record<string, unknown>): Block[];
export function asstText(blocks: Block[]): string;

// ── conversation store ──────────────────────────────────────────────────────
export interface ConversationStore {
  getState: () => unknown;
  setState: (next: unknown) => void;
  subscribe: (listener: () => void) => () => void;
  [k: string]: unknown;
}
export function createConversationStore(initial?: unknown): ConversationStore;

// ── icons ───────────────────────────────────────────────────────────────────
export const Svg: ComponentType<{ s?: number; children?: ReactNode }>;
export const Chevron: ComponentType<{ open?: boolean }>;
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
export const ChatMessages: ComponentType<Record<string, unknown>>;
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
