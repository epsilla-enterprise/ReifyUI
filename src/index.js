// UI Core — shared Conversational Agent surface (extracted from HarnessRouter).
// Plain ESM React source: consumers alias this package (Vite resolve.alias / Next webpack alias
// + tsconfig paths) and import straight from source. No build step. Only peer dep: react.
export { createResponsesDispatcher, readSSEStream, pumpResponsesStream } from './stream/responses.js';
export { withText, withReasoning, withStep, withResult, asstText } from './state/blocks.js';
export { createConversationStore } from './state/conversationStore.js';
// Gateway turns -> the message shape ChatMessages/ChatPanel render. Also on reifyui/harness; it is
// here too because ChatPanel's loadHistory takes messages, and converting history must not require
// importing a transport. Pure function, no fetch.
export { turnsToMessages } from './state/turns.js';
export { Svg, Chevron, IcDownload, IcEye, IcTool, IcPlug, IcSkill, IcTerminal, IcDoc, IcList, IcGlobe, IcSearch, IcScroll, IcSpawn, IcCheck, IcThink, IcSend, IcX, IcMic, IcPaperclip, IcPanelRight } from './components/icons.jsx';
export { humanize, parseArgs, baseName, prettyJson, toolMeta, summarizeSteps } from './components/toolMeta.js';
export { ToolGroup, ToolRow } from './components/ToolSteps.jsx';
export { ChatMessages, ChatMessagesSkeleton, UserTurn, AssistantTurn, DEFAULT_STATUS_LABELS } from './components/ChatMessages.jsx';
export { Composer } from './components/Composer.jsx';
// The whole conversation column beside a document — history, live turn, retry, attachments,
// dictation, composer. Four products had a divergent copy of this; the transport and the product's
// prose stay at the call site, everything else is here. Needs styles/chat.css.
export { ChatPanel } from './components/ChatPanel.jsx';
// Voice input through the browser's own recogniser. Returns null where the API is absent, which
// is what makes "render no microphone" the easy path and a disabled one impossible to reach for.
export { createDictation } from './input/dictate.js';
export { bytesLabel } from './format.js';
// CodeBlock lazy-imports highlight.js — the consuming app must depend on highlight.js (^11),
// same rule as mermaid for the Mermaid blocks. See components/CodeBlock.jsx.
export { CodeBlock } from './components/CodeBlock.jsx';
export { useResizablePane, PaneResizer } from './components/resizable.jsx';
// Master list beside a conversation (runs/sessions): filter, status, cursor pagination.
// Transport-agnostic — the consumer supplies fetchPage(cursor) -> {items, cursor}.
export { TaskList, taskStatusGroup } from './components/TaskList.jsx';
// In-app alert/confirm/prompt. Native browser popups block the event loop and can't be styled,
// which reads as a browser warning rather than as part of the product — these replace them with
// the same awaited call-site shape. Needs styles/dialog.css and a <DialogHost> at the root.
export { DialogHost, useDialog } from './components/Dialog.jsx';
// Shared product auth (extracted from ContextualGraph): the engine /v1/auth
// client (configureAuth({product, engine}) once at boot) + the sign-in form
// and Google SSO button. Consumers may also deep-import './auth/*'.
export {
  configureAuth, authConfig, SESSION_EVENT,
  getSession, clearSession, getToken, isAuthed,
  login, register, googleSignIn, requestPasswordReset, switchOrg,
  refreshToken, handleAuthExpired, logout, authFetch, fetchBalance,
} from './auth/client.js';
export { AuthForm } from './auth/AuthForm.jsx';
export { GoogleButton, GOOGLE_ENABLED } from './auth/GoogleButton.jsx';
// Shared AI-spreadsheet grid (reusable in the Sheets product AND studio Spaces).
export { SheetGrid, sheetToDelimited, sheetToAoA, fitRowHeights } from './sheet/SheetGrid.jsx';
// Files, drawn the same wherever they appear. FileTypeIcon uses react-file-icon when it is
// installed (an optional peer) and falls back to an extension badge when it is not.
export { FileTypeIcon, extOf } from './components/FileTypeIcon.jsx';
export { FileCard } from './components/FileCard.jsx';
export { FilePreview } from './components/FilePreview.jsx';
// Form primitives. Every surface here had been hand-rolling label+select+textarea, which is why
// the same form looked different in each of them.
export { Field, Input, Textarea, Select, FormActions, Button } from './components/form.jsx';
// ── the library page: the surface a document product opens on ────────────────
// Small, product-agnostic pieces that existed 3-6 times each across the products built on this
// package, every copy slightly different. Needs styles/library.css (+ chip.css, preview.css).
export { Carousel } from './components/Carousel.jsx';
export { Card } from './components/Card.jsx';
export { Chip } from './components/Chip.jsx';
export { SearchField } from './components/SearchField.jsx';
// Anchored panel with placement built in — flips, clamps to the viewport, closes on Escape and
// outside press. Ten hand-rolled versions of this existed; one survived a phone.
export { Popover } from './components/Popover.jsx';
// A dialog whose body is yours (useDialog answers a question; this holds content). Shares the
// dialog host's Escape ordering and overlay layer. Needs styles/preview.css.
export { Modal } from './components/Modal.jsx';
export { useTypewriter } from './hooks/useTypewriter.js';
