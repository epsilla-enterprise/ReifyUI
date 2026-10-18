// Types for reifyui/agent-chat. Hand-written (the source is JSX), kept beside the source.
import type { ReactNode, ReactElement, RefObject } from 'react';

export type TurnStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'incomplete';
export type CallStatus = 'running' | 'done' | 'failed' | 'stopped';

export interface TextItem { kind: 'text'; id: string; text: string; closed?: boolean }
export interface ThinkingItem { kind: 'thinking'; id: string; text: string; startedAt: number | null; endedAt: number | null; open?: boolean }
export interface ToolItem {
  kind: 'tool'; id: string; itemId?: string | null; name: string; args: string;
  output?: string; status: CallStatus; startedAt: number | null; endedAt: number | null;
  /** the whole output's length when the record keeps only its start */
  truncated?: number | null;
}
export type TurnItem = TextItem | ThinkingItem | ToolItem;

export interface TurnFile { container_id: string; file_id: string; filename: string; download_url?: string }
export interface TurnUser { text: string; files?: { name: string; size?: number; src?: string }[] }
export interface Usage { input_tokens?: number; output_tokens?: number; total_tokens?: number; [k: string]: unknown }

export interface Turn {
  id: string | null;
  sessionId: string | null;
  status: TurnStatus;
  user: TurnUser | null;
  items: TurnItem[];
  files: TurnFile[];
  /** epoch ms the turn was sent or first observed; null when nobody observed it */
  startedAt: number | null;
  endedAt: number | null;
  /** a measured length from a record (seconds × 1000), used when the two ends were not observed */
  elapsedMs?: number | null;
  lastEventAt: number | null;
  usage: Usage | null;
  error: string | null;
  incomplete: { reason: string; detail: string } | null;
  model: string | null;
}

/** Any Responses stream event, an `error` event, or the broadcast feed's `harness.turn.started`. */
export interface AgentEvent { type: string; [k: string]: unknown }

export function newTurn(opts?: { id?: string; sessionId?: string; status?: TurnStatus; user?: TurnUser | null; startedAt?: number | null; model?: string }): Turn;
/** Fold one event in. `at`: receive time (epoch ms) for a live event, null for a replayed one. */
export function reduceTurn(turn: Turn | null | undefined, ev: AgentEvent, at?: number | null): Turn;
export function finish(turn: Turn, status: TurnStatus | string, at?: number | null, response?: Record<string, unknown> | null): Turn;
export function turnFromEvents(events: AgentEvent[], opts?: Parameters<typeof newTurn>[0] & { at?: number | null }): Turn;
export function turnFromResponse(resp: Record<string, unknown>, opts?: Parameters<typeof newTurn>[0] & { startedAt?: number | null; endedAt?: number | null }): Turn;
/** One entry of GET /v1/sessions/{sid}/turns. */
export function turnFromHistory(h: Record<string, unknown>): Turn;
/** A blocks-model message ({blocks, status, files, elapsed}) as a turn, timed from `clock` when given. */
export function turnFromMessage(msg: { blocks?: unknown[]; status?: string; files?: TurnFile[]; elapsed?: number; incompleteReason?: string; incompleteDetail?: string; id?: string },
  clock?: Turn | null, user?: TurnUser | null): Turn;
export function liveState(turn: Turn | null | undefined): { phase: 'starting' | 'thinking' | 'tool' | 'writing'; tool: ToolItem | null } | null;
export function segments(turn: Turn): ({ type: 'text'; item: TextItem } | { type: 'work'; items: (ToolItem | ThinkingItem)[] })[];
export function latestPlan(turn: Turn, describe: typeof describeTool): TodoEntry[] | null;
export function isTerminal(status: string): boolean;

export type ToolKind = 'shell' | 'shell_output' | 'read' | 'write' | 'edit' | 'search' | 'glob' | 'list' | 'web_search' | 'web_fetch'
  | 'agent' | 'todo' | 'skill' | 'think' | 'toolsearch' | 'browser' | 'mcp' | 'tool';
export interface TodoEntry { text: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }
export interface ToolDescription {
  kind: ToolKind; target: string; targetFull: string; mono: boolean; note: string;
  running: string; done: string;
  diff: { added: number; removed: number } | null;
  todos: TodoEntry[] | null;
}
export function describeTool(name: string, args: unknown): ToolDescription;
export function toolKind(name: string): ToolKind;
export function toolLine(d: ToolDescription, state: 'running' | 'done'): string;
export function summarizeCalls(calls: { name: string; args?: unknown }[]): string;
export function resultNote(kind: ToolKind, output: unknown): string;
export function parseToolArgs(args: unknown): Record<string, unknown>;
export function todosOf(args: Record<string, unknown>): TodoEntry[] | null;
export function diffOf(kind: ToolKind, args: Record<string, unknown>): { added: number; removed: number } | null;
export function patchStats(patch: string): { added: number; removed: number };
export function commandText(args: Record<string, unknown>): string;
export function baseNameOf(path: unknown): string;
export function lineCount(s: unknown): number;

export function formatElapsed(ms: number | null | undefined): string;
export function formatDuration(ms: number | null | undefined): string;
export function formatTokens(n: number | null | undefined): string;
export function useNow(on: boolean, everyMs?: number): number;
export function useElapsed(start: number | null | undefined, end?: number | null): number | null;

export type Motion = 'bloom' | 'sheen' | 'glint' | 'flutter' | 'glide' | 'blink' | 'flip' | 'swim' | 'spin' | 'wave'
  | 'dash' | 'scuttle' | 'equalize' | 'bob' | 'pulse' | 'dots';
export const MARK_MOTIONS: Record<string, Motion>;
export const MOTIONS: Motion[];
export function motionFor(base: string | null | undefined): Motion;

export interface AgentLabels {
  starting: string; thinking: string; writing: string; tool: string; thought: string;
  thoughtFor: (t: string) => string; workedFor: (t: string) => string; worked: string; tokens: (n: string) => string;
  stopped: string; stoppedAfter: (t: string) => string; failed: string; failedAfter: (t: string) => string; incomplete: string;
  input: string; output: string; noOutput: string; copy: string; copied: string; copyFailed: string;
  moreLines: (n: number) => string; fewerLines: string; failedCalls: (n: number) => string; stoppedCall: string;
  plan: string; jump: string; send: string; stop: string; stopping: string; attach: string; remove: (name: string) => string; working: string;
}
export const DEFAULT_AGENT_LABELS: AgentLabels;

export interface MarkProps { mark?: ReactNode; motion?: Motion | string }

export function WorkingMark(props: MarkProps & { size?: number; still?: boolean }): ReactElement;
export function WorkingIndicator(props: MarkProps & {
  start?: number | null; end?: number | null; label: string; onToggle?: () => void; expanded?: boolean; controls?: string;
  className?: string; shimmer?: boolean; size?: number;
}): ReactElement;
export function CopyButton(props: { text: string; labels?: AgentLabels; label?: string }): ReactElement;
export function DiffBadge(props: { diff: { added: number; removed: number } | null }): ReactElement | null;
export function LinesBlock(props: { lines: { text: string; cls?: string }[]; limit?: number; labels?: AgentLabels; className?: string; numbered?: boolean }): ReactElement;
export function StepRow(props: { item: ToolItem; labels?: AgentLabels; defaultOpen?: boolean }): ReactElement;
export function ThinkingRow(props: { item: ThinkingItem; labels?: AgentLabels }): ReactElement;
export function WorkGroup(props: MarkProps & { items: (ToolItem | ThinkingItem)[]; live?: boolean; liveLabel?: string; start?: number | null;
  labels?: AgentLabels; defaultOpen?: boolean }): ReactElement | null;
export function TodoCard(props: { todos: TodoEntry[] | null; labels?: AgentLabels; running?: boolean }): ReactElement | null;
export function StreamingText(props: { text: string; active?: boolean; render?: (text: string) => ReactNode }): ReactElement;
export function UserBubble(props: { user: TurnUser | null; renderFile?: (f: { name: string; src?: string }, i: number) => ReactNode; extra?: ReactNode }): ReactElement | null;
export function TurnOutcome(props: { turn: Turn; labels?: AgentLabels; describeIncomplete?: (i: { reason?: string; detail?: string }) => string }): ReactElement | null;

export interface AgentTurnViewProps extends MarkProps {
  turn: Turn | null;
  /** markdown renderer for prose (inject yours); default is plain pre-wrapped text */
  renderMarkdown?: (text: string) => ReactNode;
  labels?: Partial<AgentLabels>;
  showUser?: boolean;
  renderUserFile?: (f: { name: string; src?: string }, i: number) => ReactNode;
  userExtra?: ReactNode;
  /** a line above the agent's part (who answered, on which model) */
  meta?: ReactNode;
  /** the turn's produced files, drawn by the host (it owns their fetching) */
  renderFiles?: (turn: Turn) => ReactNode;
  /** under a finished turn: copy, retry, open the trace */
  actions?: ReactNode;
  describeIncomplete?: (i: { reason?: string; detail?: string }) => string;
  /** the epoch ms the live clock counts from, when it is not the turn's own startedAt */
  liveStart?: number | null;
}
export function AgentTurnView(props: AgentTurnViewProps): ReactElement | null;

export interface ComposerAttachment { id?: string; name: string; src?: string; size?: number; status?: 'uploading' | 'ready' | 'error' }
export interface AgentComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running?: boolean;
  stopping?: boolean;
  disabled?: boolean;
  /** overrides the default (empty box, no attachment) */
  sendDisabled?: boolean;
  placeholder?: string;
  runningPlaceholder?: string;
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (index: number) => void;
  /** shows the attach button, takes dropped and pasted files */
  onAttachFiles?: (files: FileList) => void;
  accept?: string;
  multiple?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  inputId?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  maxRows?: number;
  labels?: Partial<AgentLabels>;
  ariaLabel?: string;
  className?: string;
}
export function AgentComposer(props: AgentComposerProps): ReactElement;

export function useStickToBottom(contentRef: RefObject<HTMLElement | null>, opts?: { scroller?: HTMLElement | null; anchorRef?: RefObject<HTMLElement | null> | null; followKey?: unknown; threshold?: number; enabled?: boolean }):
  { atBottom: boolean; toBottom: () => void };

export interface AgentConversationProps extends MarkProps {
  children?: ReactNode;
  composer?: ReactNode;
  notice?: ReactNode;
  running?: boolean;
  /** 'pane' fills a fixed-height box and scrolls in it; 'page' lives in a scrolling page */
  mode?: 'pane' | 'page';
  /** change it (a new turn sent) to return to the bottom */
  followKey?: unknown;
  labels?: Partial<AgentLabels>;
  className?: string;
  empty?: ReactNode;
}
export function AgentConversation(props: AgentConversationProps): ReactElement;
