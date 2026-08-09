// UI Core — shared Conversational Agent surface (extracted from HarnessRouter).
// Plain ESM React source: consumers alias this package (Vite resolve.alias / Next webpack alias
// + tsconfig paths) and import straight from source. No build step. Only peer dep: react.
export { createResponsesDispatcher, readSSEStream, pumpResponsesStream } from './stream/responses.js';
export { withText, withReasoning, withStep, withResult, asstText } from './state/blocks.js';
export { createConversationStore } from './state/conversationStore.js';
export { Svg, Chevron, IcTool, IcPlug, IcSkill, IcTerminal, IcDoc, IcList, IcGlobe, IcSearch, IcScroll, IcSpawn, IcCheck, IcThink, IcSend } from './components/icons.jsx';
export { humanize, parseArgs, baseName, prettyJson, toolMeta, summarizeSteps } from './components/toolMeta.js';
export { ToolGroup, ToolRow } from './components/ToolSteps.jsx';
export { ChatMessages, ChatMessagesSkeleton, UserTurn, AssistantTurn, DEFAULT_STATUS_LABELS } from './components/ChatMessages.jsx';
export { Composer } from './components/Composer.jsx';
// CodeBlock lazy-imports highlight.js — the consuming app must depend on highlight.js (^11),
// same rule as mermaid for the Mermaid blocks. See components/CodeBlock.jsx.
export { CodeBlock } from './components/CodeBlock.jsx';
export { useResizablePane, PaneResizer } from './components/resizable.jsx';
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
export { SheetGrid, sheetToDelimited, sheetToAoA } from './sheet/SheetGrid.jsx';
