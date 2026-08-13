// Type declarations for `reifyui/slides`.
//
// Hand-authored, like the root index: the source is plain JSX, so there is nothing to infer from.
// The deck model below is the contract — an agent writing a deck and this renderer drawing one are
// agreeing on exactly these shapes, so it is worth stating them precisely rather than as `any`.
import type { ComponentType, CSSProperties } from 'react';

// ── deck model ────────────────────────────────────────────────────────────────────────────────
/** Absolute placement on the fixed 1920x1080 stage. Every element carries one. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

/** A span of text plus its marks. `link` is an object mark; the rest are plain strings. */
export interface Run {
  text: string;
  marks?: Array<'bold' | 'italic' | 'underline' | 'code' | { link: string }>;
}

export type ElementType = 'text' | 'image' | 'shape' | 'table' | 'chart' | 'diagram' | 'code';

export interface SlideElement {
  id: string;
  type: ElementType;
  frame: Frame;
  style?: CSSProperties & { fontSize?: number; align?: 'left' | 'center' | 'right'; fill?: string };
  /** Shape depends on `type`: text/bullets carry `runs`, images carry `src`, charts carry `spec`. */
  content?: Record<string, unknown> & { role?: string; runs?: Run[]; src?: string; alt?: string };
}

export interface Slide {
  id: string;
  layout?: string;
  background?: { color?: string; image?: string };
  notes?: string;
  elements?: SlideElement[];
}

export interface Theme {
  palette?: { bg?: string; ink?: string; mute?: string; brand?: string; accent?: string };
  fonts?: { head?: string; body?: string };
}

export interface Deck {
  meta?: { title?: string; [k: string]: unknown };
  stage?: { width: number; height: number };
  theme?: Theme;
  slides?: Slide[];
}

/** Rewrites an element's `src` before it is fetched — point workspace-relative paths at your API. */
export type ResolveSrc = (src: string) => string;

// ── rendering ─────────────────────────────────────────────────────────────────────────────────
/** The theme as CSS custom properties (`--sl-bg`, `--sl-body`, ...), for spreading into a style. */
export function themeVars(theme?: Theme): CSSProperties;

export interface SlideStageProps {
  slide?: Slide;
  theme?: Theme;
  resolveSrc?: ResolveSrc;
  selectedId?: string | null;
  onSelectElement?: (id: string) => void;
}

/** One slide at true 1920x1080. Scale it yourself — used by SlideView, EditorCanvas and print. */
export const SlideStage: ComponentType<SlideStageProps>;

export interface SlideViewProps extends SlideStageProps {
  onDeselect?: () => void;
  /** Drop the frame/shadow and render only the stage — for thumbnails and print pages. */
  bare?: boolean;
}

/** A slide scaled to fit its container. The read-only renderer: thumbnails, previews, print. */
export const SlideView: ComponentType<SlideViewProps>;

/** A single element, unpositioned. Exported for hosts composing their own stage. */
export const ElementView: ComponentType<{ el: SlideElement; resolveSrc?: ResolveSrc }>;

// ── editing ───────────────────────────────────────────────────────────────────────────────────
/** A peer's cursor state, for multiplayer decorations. Omit `peers` for single-player. */
export interface Peer {
  id: string;
  name: string;
  color: string;
  sel?: { slideId: string; elId: string };
  drag?: { elId: string; frame: Frame };
}

export interface EditorCanvasProps {
  slide?: Slide;
  theme?: Theme;
  resolveSrc?: ResolveSrc;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** A committed change to one element. The canvas never mutates the deck — the host owns state. */
  onPatchElement?: (elementId: string, patch: Partial<SlideElement>) => void;
  onDeleteElement?: (elementId: string) => void;
  /** Fires continuously during a drag/resize, then with (null, null). For collab broadcast. */
  onDragState?: (elementId: string | null, frame: Frame | null) => void;
  peers?: Peer[];
  /** Selection still works; nothing can be moved, resized, typed into or deleted. */
  readOnly?: boolean;
}

/**
 * Direct manipulation over the deck renderer: click-drag to move, corner handles to resize,
 * double-click to edit text inline, Delete to remove, arrows to nudge (Shift for a coarse step).
 * Every commit leaves as a typed patch, so undo, autosave and collaboration stay with the host.
 */
export const EditorCanvas: ComponentType<EditorCanvasProps>;

// ── presenting ────────────────────────────────────────────────────────────────────────────────
/** Full-screen presentation with arrow/space navigation. Calls `onExit` on Escape. */
export const Presentation: ComponentType<{
  deck?: Deck;
  resolveSrc?: ResolveSrc;
  startIndex?: number;
  onExit?: () => void;
}>;
