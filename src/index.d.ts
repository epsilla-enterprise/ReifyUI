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

/** Frame an SSE byte stream. Takes the response BODY, and hands back each frame's raw `data:`
 *  payload as a STRING — parsing is the caller's (see pumpResponsesStream for the parsed form). */
export function readSSEStream(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void>;

/** Read + decode in one call. Resolves to the response id. */
export function pumpResponsesStream(
  body: ReadableStream<Uint8Array>,
  handlers: ResponseHandlers,
): Promise<string | null>;

// ── block state machine ─────────────────────────────────────────────────────
// An assistant turn is an ORDERED list of blocks appended as events arrive, so tool activity
// interleaves with prose in real time instead of every tool being hoisted above the text.
export interface ToolStep {
  name: string;
  args?: string;
  result?: unknown;
  callId?: string;
  [k: string]: unknown;
}
export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; reasoning: string; steps: ToolStep[] };

// The transforms are generic over the caller's block type: they only ever read `kind` (and, in
// withResult, a step's `callId`/`result`), and otherwise pass values through untouched. An app
// with a stricter Block/ToolStep of its own keeps it, rather than having every result widened to
// this module's shape. Block above is the DEFAULT for apps that don't declare their own.
/** Append prose, merging into a trailing text block. */
export function withText<B = Block>(blocks: B[], delta: string): B[];
/** Append reasoning, merging into a trailing tools block. */
export function withReasoning<B = Block>(blocks: B[], delta: string): B[];
/** Append a tool step, merging into a trailing tools block. */
export function withStep<B = Block, S = ToolStep>(blocks: B[], step: S): B[];
/** Attach a result to the pending step with this call id. */
export function withResult<B = Block>(blocks: B[], callId: string, output: unknown): B[];
/** All prose of an assistant MESSAGE joined — takes the message, not its blocks. */
export function asstText(message: { blocks: readonly unknown[] }): string;

// ── conversation store ──────────────────────────────────────────────────────
// A tiny keyed store with a React binding: `use(key)` subscribes, `get`/`set` read and write
// outside render. Values are whatever the caller puts in, so they stay generic per key.
export interface ConversationStore {
  get<T = unknown>(key: string): T;
  /** Shallow-merges a partial into the key's current state (or the partial a function returns). */
  set<T = unknown>(key: string, patch: Partial<T> | ((prev: T) => Partial<T>)): void;
  seed(key: string, value: unknown): void;
  updateLastAssistant(key: string, update: (msg: unknown) => unknown): void;
  use<T = unknown>(key: string): T;
}
/** `makeInitial(key)` supplies the starting value the first time a key is read. */
export function createConversationStore(
  makeInitial?: (key: string) => unknown,
): ConversationStore;

// ── history replay ──────────────────────────────────────────────────────────
/** One turn as the gateway records it: the person's text, the assistant's, and the tools between. */
export interface Turn {
  user?: string;
  assistant?: string;
  status?: string;
  tools?: Array<{ name: string; arguments?: string; result?: unknown }>;
}
/** A rendered message: a user line, or an assistant turn as its ordered blocks. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  text?: string;
  blocks?: Block[];
  status?: 'running' | 'done' | 'failed' | 'cancelled' | 'incomplete';
  /** Names of the files sent WITH this message. ChatPanel sets it on send; history never has it. */
  files?: string[];
}
/** Gateway turns -> the message shape ChatMessages and ChatPanel render. */
export function turnsToMessages(turns: Turn[]): ChatMessage[];

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
export const IcX: ComponentType<{ size?: number }>;
export const IcMic: ComponentType<{ size?: number }>;
export const IcPaperclip: ComponentType<{ size?: number }>;
export const IcPanelRight: ComponentType<{ size?: number }>;

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
// Generic over YOUR message type: the renderer never inspects a message beyond `role` and its
// blocks, so the slots hand back whatever shape you passed in rather than widening it.
export interface ChatMessagesProps<M = any> {
  messages: M[];
  renderMarkdown?: (text: string) => ReactNode;
  renderMessage?(message: M, index: number): ReactNode;
  renderStep?(step: ToolStep, index: number): ReactNode;
  userExtras?(message: M, index: number): ReactNode;
  /** Rendered on the live "working" row — a node, not a slot function. */
  workingExtra?: ReactNode;
  assistantFooter?(message: M, index: number): ReactNode;
  statusLabels?: Record<string, string>;
  workingLabel?: string;
  toolLabels?: Record<string, string>;
  [k: string]: unknown;
}
export const ChatMessages: <M = unknown>(props: ChatMessagesProps<M>) => ReactNode;
export const ChatMessagesSkeleton: ComponentType<Record<string, unknown>>;
export const UserTurn: ComponentType<Record<string, unknown>>;
export const AssistantTurn: ComponentType<Record<string, unknown>>;
export const DEFAULT_STATUS_LABELS: Record<string, string>;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** Disables the textarea itself. */
  disabled?: boolean;
  /** Disables the send button — and, since 0.6.0, the Enter key with it. */
  sendDisabled?: boolean;
  placeholder?: string;
  rows?: number;
  /** Grow to fit the text, up to maxRows, then scroll. Exclusive with a CSS min-height. */
  autoGrow?: boolean;
  maxRows?: number;
  autoFocus?: boolean;
  /** The accessible name. Give one whenever the placeholder animates — it is otherwise the only
   *  name the field has, and it changes every few seconds. */
  inputAriaLabel?: string;
  /** Node rendered ABOVE the textarea, e.g. a row of staged attachments. */
  attachments?: ReactNode;
  accessoriesLeft?: ReactNode;
  accessoriesRight?: ReactNode;
  /** Replaces the default send button entirely. */
  renderSend?: () => ReactNode;
  /** Each REPLACES the default class, so a product restyles wholesale instead of fighting it. */
  classNames?: { root?: string; input?: string; row?: string };
  inputRef?: { current: HTMLTextAreaElement | null };
}
export const Composer: ComponentType<ComposerProps>;
export const CodeBlock: ComponentType<{ code?: string; lang?: string; [k: string]: unknown }>;

// ── ChatPanel: the whole conversation column ─────────────────────────────────
/** A file picked but not yet sent. `payload` is whatever the caller's prepare() produced and the
 *  panel never looks inside it — it hands the list straight back to runTurn. */
export interface StagedFile {
  name: string;
  size?: number;
  payload?: unknown;
  /** True between the pick and prepare() resolving. The panel sets it; prepare() never returns it. */
  pending?: boolean;
}

/** The dispatcher's callbacks, plus the session id a brand-new document learns mid-stream. */
export type TurnHandlers = ResponseHandlers;

/** Run one turn. The panel does not know whether that is one stream, a stream with a fallback, or
 *  three requests — only that progress arrives through `handlers`.
 *  Resolve `{ connecting: true }` when the backend is not up yet: the panel then holds the
 *  message (with its files) and retries, instead of showing a failed turn. */
export type RunTurn = (args: {
  sessionId: string;
  text: string;
  attachments: StagedFile[];
  handlers: TurnHandlers;
}) => Promise<{ connecting?: boolean } | void>;

/** The conversation so far, already as messages — callers write `.then(turnsToMessages)`. A
 *  caller whose brand-new document has no session yet resolves [] here without a request. */
export type LoadHistory = (sessionId: string) => Promise<ChatMessage[]>;

export interface ChatPanelProps {
  /** Opaque to the panel: it is never parsed, so a placeholder id for an unsaved document is
   *  fine. When it changes mid-stream to the real id, the panel recognises its own adoption and
   *  does not reload over the turn arriving live. */
  sessionId: string;
  runTurn: RunTurn;
  loadHistory: LoadHistory;
  /** The turn opened a session. Adopt the id — the panel will not treat that as a new document. */
  onSessionStarted?: (sessionId: string) => void;
  /** A turn finished (here, or elsewhere): the document may have changed underneath. */
  onChanged?: () => void;

  /** A first message carried in from somewhere else (a landing prompt). Sent once, and only when
   *  there is no history. */
  seed?: string;
  /** Fires before the history request whenever a seed was supplied — strip it from the URL here,
   *  so a refresh or a back-button cannot resend it. */
  onSeedConsumed?: () => void;

  /** A turn is running that this panel did not start (another tab, or the first turn before the
   *  session is queryable). The panel polls history while it is true and reloads once when it
   *  goes false. */
  externalBusy?: boolean;

  /** Enables the attach control. prepare() turns a File into the entry runTurn will receive; it
   *  rejects with the message the person sees. Null (default) renders no control at all. */
  attachments?: {
    prepare: (file: File) => Promise<StagedFile>;
    accept?: string;
    /** Default true. */
    multiple?: boolean;
  } | null;
  /** From createDictation(), built ONCE (useState(() => createDictation())) — a new object every
   *  render stops the recogniser every render. Null (default) renders no microphone, never a
   *  disabled one. */
  dictation?: {
    start(handlers: { onText?: (text: string) => void; onEnd?: () => void; onError?: (message: string) => void }): void;
    stop(): void;
  } | null;

  title?: string;
  /** Header content after the title, e.g. a "the agent is working" mark. */
  headerRight?: ReactNode;
  collapsed?: boolean;
  /** Absent → the collapse toggle is not rendered. */
  onToggleCollapse?: () => void;
  /** Panel width in px, from your own drag handle. Ignored while collapsed. */
  width?: number;

  placeholder?: string;
  /** Shown when there is no conversation. */
  emptyState?: ReactNode;
  /** Shown INSTEAD of emptyState while externalBusy and empty — never falls back to it: a blank
   *  "describe what you want" prompt is a dead end while the agent is visibly working. */
  busyState?: ReactNode;
  connectingLabel?: string;
  connectingNote?: ReactNode;
  workingLabel?: string;
  statusLabels?: { failed?: string; cancelled?: string; incomplete?: string };
  renderMarkdown?: (text: string) => ReactNode;
  /** Extra content inside a user bubble. Return undefined to fall through to the built-in file
   *  chips, the same contract ChatMessages uses. */
  userExtras?: (message: ChatMessage, index: number) => ReactNode | undefined;
  toolLabels?: Record<string, string>;
  /** The panel's placement in YOUR layout. Everything it paints inside is the package's. */
  classNames?: { root?: string };
}
export const ChatPanel: ComponentType<ChatPanelProps>;

// ── voice input ─────────────────────────────────────────────────────────────
export interface Dictation {
  /** onText fires once per finished phrase, so a draft grows as you speak. */
  start(handlers: {
    onText?: (text: string) => void;
    onEnd?: () => void;
    onError?: (message: string) => void;
  }): void;
  stop(): void;
}
/** Null where the browser has no recogniser — render nothing, not a disabled button. */
export function createDictation(options?: { lang?: string }): Dictation | null;

/** A byte count as a person reads it. null/undefined -> '' (unknown is not zero). */
export function bytesLabel(bytes: number | null | undefined): string;

// ── library page pieces ─────────────────────────────────────────────────────
export interface CarouselProps {
  /** Names the scroll region and its buttons ("Scroll templates left"). */
  label: string;
  /** px per press. Defaults to 90% of the visible width. */
  step?: number;
  children?: ReactNode;
  classNames?: { root?: string; viewport?: string; button?: string };
}
/** Buttons disable at each edge and are not rendered at all when the content already fits.
 *  Item width comes from --uic-car-item (default 236px). */
export const Carousel: ComponentType<CarouselProps>;

export interface CardProps {
  /** The thumbnail node; this component supplies the box around it. */
  art?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Makes art + title one button. Omit while an inline rename field is in `title`. */
  onClick?: () => void;
  selected?: boolean;
  /** Floats over the art on hover; always visible where there is no hover. */
  overlay?: ReactNode;
  /** Sits in the title row — a sibling of the main button, never inside it. */
  actions?: ReactNode;
  classNames?: { root?: string };
}
export const Card: ComponentType<CardProps>;

export interface ChipProps {
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  /** Required with onRemove: "✕" alone does not say which of five chips it removes. */
  removeLabel?: string;
  className?: string;
}
export const Chip: ComponentType<ChipProps>;

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Also the accessible name. */
  placeholder?: string;
  clearLabel?: string;
  className?: string;
}
export const SearchField: ComponentType<SearchFieldProps>;

export interface PopoverProps {
  open: boolean;
  /** The control it belongs to; the panel positions against its box and a press on it is not
   *  treated as an outside press. */
  anchorRef: { current: HTMLElement | null };
  onClose?: () => void;
  /** Preferred width, clamped to the viewport. */
  width?: number;
  /** Flip to the other side rather than squeeze below this. */
  minHeight?: number;
  placement?: 'auto' | 'below' | 'above';
  label?: string;
  className?: string;
  children?: ReactNode;
}
/** Portals to the body and positions itself fixed — never clipped by an ancestor's overflow. */
export const Popover: ComponentType<PopoverProps>;

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  description?: ReactNode;
  /** Header buttons, before the close ✕. */
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  /** An exact width, overriding `size`. */
  width?: number | string;
  /** id of your own heading, when the name does not live in `title`. */
  labelledBy?: string;
  children?: ReactNode;
  classNames?: { backdrop?: string; root?: string; body?: string };
}
/** Shares the dialog host's Escape ordering: the last overlay opened answers the key. */
export const Modal: ComponentType<ModalProps>;

/** Types `phrases` out one at a time. Honours prefers-reduced-motion (shows the first phrase and
 *  stops). Speed and order are not configurable — they were the only differences between the
 *  three implementations this replaces. */
export function useTypewriter(phrases: string[], options?: { active?: boolean }): string;

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
export interface SheetColumn {
  id: string;
  name: string;
  type: string;
  width?: number;
  options?: Array<string | { label?: string; value?: unknown; color?: string }>;
  [key: string]: unknown;
}
export interface SheetRow { id: string; height?: number; [key: string]: unknown }
export interface SheetCell { value?: unknown; status?: string; error?: string | null; [key: string]: unknown }
export interface Sheet {
  meta?: { title?: string; [key: string]: unknown };
  columns?: SheetColumn[];
  rows?: SheetRow[];
  cells?: Record<string, SheetCell>;
  [key: string]: unknown;
}

/** One entry in the grid's column vocabulary. A host adds a column kind by adding a descriptor
 *  — the grid has no hardcoded knowledge of any type beyond its own defaults. */
export interface SheetColumnType {
  type: string;
  label: string;
  /** The app fills these cells: status dot, tint, and run affordances. */
  computed?: boolean;
  /** Defaults to !computed. */
  editable?: boolean;
  /** The column key holding this type's config; dropped when the type changes. */
  configKey?: string;
  /** An extra header sub-label, e.g. which kind of compute this is. */
  badge?: (column: SheetColumn) => string | undefined;
  /** How much room this type's config popover needs. Defaults to 250 x 340. */
  configWidth?: number;
  configHeight?: number;
}

export interface SheetCellRenderContext {
  cell: SheetCell;
  column: SheetColumn;
  row: SheetRow;
  rowIndex: number;
  sheet: Sheet;
  computed: boolean;
  width?: number;
  height?: number;
  editing: boolean;
  readOnly: boolean;
  setCell: (value: unknown) => void;
  runCell: (() => void) | null;
}

export interface SheetColumnConfigContext {
  column: SheetColumn;
  columns: SheetColumn[];
  /** The type currently selected in the popover, which may differ from column.type. */
  type: string;
  /** Commit the column patch and close the popover. */
  applyPatch: (patch: Record<string, unknown>) => void;
  deleteColumn: () => void;
  close: () => void;
}

export interface SheetGridProps {
  sheet: Sheet;
  onChange?: (next: Sheet) => void;
  onRunCell?: (rowId: string, colId: string) => void;
  onRunColumn?: (colId: string) => void;
  readOnly?: boolean;
  fetchBlobUrl?: (path: string) => Promise<string>;
  onOpenResource?: (ref: Record<string, unknown>) => void;
  peerMarks?: Record<string, { name: string; color: string }>;
  onActiveCell?: (cellKey: string | null) => void;
  columnTypes?: SheetColumnType[];
  /** Replace a cell's body. Return undefined to fall through to the built-in rendering. */
  renderCell?: (ctx: SheetCellRenderContext) => ReactNode | undefined;
  /** Replace the column popover's body. Return undefined to fall through. */
  renderColumnConfig?: (ctx: SheetColumnConfigContext) => ReactNode | undefined;
}
export const SheetGrid: ComponentType<SheetGridProps>;

/** cellText says what one cell is worth in a flat file — without it, a cell holding an object
 *  exports as raw JSON. */
export interface SheetExportOptions {
  cellText?: (cell: SheetCell | undefined, column: SheetColumn) => string | number | boolean;
}
export function sheetToDelimited(sheet: Sheet, delimiter?: string, options?: SheetExportOptions): string;
export function sheetToAoA(sheet: Sheet, options?: SheetExportOptions): unknown[][];

// ── boards: panels and the grid they sit in ──────────────────────────────────
export interface PanelProps {
  title?: ReactNode;
  /** Heading level, so a board fits YOUR document outline. Default 'h3'. */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'div';
  /** Quiet second line under the title — when it last refreshed, what it counts. */
  meta?: ReactNode;
  /** Controls in the header, after the title. A press on one never drags the panel. */
  actions?: ReactNode;
  footer?: ReactNode;

  /** No content yet: the body becomes a placeholder of the same size, so a board of four
   *  requests does not reflow four times as they land. */
  loading?: boolean;
  /** The name a screen reader is given while loading. Default 'Loading'. */
  loadingLabel?: string;
  /** Content is up and being refreshed: the header shows it and the body stays readable. */
  busy?: boolean;
  busyLabel?: string;

  /** What went wrong, verbatim — shown monospace, selectable and scrollable, because the error
   *  is the thing that lets someone fix what produced it. Wins over `children`, loses to
   *  `loading` (a retry in flight should not still show the failure it is retrying). */
  error?: ReactNode;
  /** The line above the message. Default 'This panel could not load'. */
  errorTitle?: ReactNode;
  /** Extra context under the message, folded away — e.g. the statement that failed. */
  errorDetail?: ReactNode;
  detailLabel?: ReactNode;
  /** Absent → no retry control is drawn, rather than one that does nothing. */
  onRetry?: () => void;
  retryLabel?: ReactNode;

  className?: string;
  classNames?: { root?: string; head?: string; body?: string };
  children?: ReactNode;
}
/** The frame around one thing on a board. Fills the cell it is given: put it in a box with a
 *  height. Its header carries `.uic-panel-head`, which is what PanelGrid drags by. */
export const Panel: ComponentType<PanelProps>;

/** One panel's cell. x/w are COLUMNS and y/h are ROWS — never pixels. */
export interface PanelLayoutItem {
  /** Matches the child's React `key`. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  /** Neither moves nor resizes, and other panels flow around it. */
  static?: boolean;
}

export interface PanelGridProps {
  layout: PanelLayoutItem[];
  /** One element per layout entry, matched by `key`. A child with no entry is not rendered. */
  children?: ReactNode;
  cols?: number;
  /** px per row. Default 40. */
  rowHeight?: number;
  /** px between cells. Default 12. */
  gap?: number;
  /** Default false: nothing drags, nothing resizes, and no handle is drawn. */
  editable?: boolean;
  /** Selector a press must land inside to start a move. Default '.uic-panel-head' — Panel's own
   *  header. Point it at your own element and give that element `touch-action: none`. */
  dragHandle?: string;
  /** Below this container width the grid becomes ONE column in layout order and stops being
   *  arrangeable. Default 640. */
  stackAt?: number;
  /** The resize handle's accessible name. Name the panel in it. */
  resizeLabel?: (id: string) => string;
  /** Fires ONCE per interaction, on release — not per pixel. The layout stays yours: nothing
   *  moves until you apply what this hands you. */
  onLayoutChange?: (layout: PanelLayoutItem[]) => void;
  className?: string;
}
/** A grid of panels you can drag and resize, whose read-only mode is the default. Gravity is up
 *  and always on: the panel you drop keeps the cell you dropped it in, the rest flow around it. */
export const PanelGrid: ComponentType<PanelGridProps>;

/** Gravity applied to a layout you built yourself. Add a panel with `y: Infinity` to put it at
 *  the bottom, then pass the array through this to turn that into a real row. */
export function packLayout(layout: PanelLayoutItem[], cols?: number): PanelLayoutItem[];
