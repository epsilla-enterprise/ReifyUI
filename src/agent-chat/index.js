// reifyui/agent-chat: an agent's turn the way Claude Code shows it.
//
//   the data      newTurn, reduceTurn, finish, turnFromEvents, turnFromResponse, turnFromHistory,
//                 turnFromMessage, liveState, segments, latestPlan, isTerminal
//   the words     describeTool, toolKind, toolLine, summarizeCalls, resultNote, parseToolArgs,
//                 todosOf, diffOf, patchStats, commandText, browserActOf, browserElements
//   the clocks    formatElapsed, formatDuration, formatTokens, useElapsed, useNow
//   the marks     MARK_MOTIONS, MOTIONS, motionFor
//   the views     AgentConversation, AgentTurnView, WorkGroup, StepRow, ThinkingRow, TodoCard,
//                 WorkingIndicator, WorkingMark, StreamingText, TurnOutcome, UserBubble,
//                 AgentComposer, CopyButton, DiffBadge, LinesBlock, useStickToBottom,
//                 DEFAULT_AGENT_LABELS
//   the files     ArtifactPanel, FileCard, FilePreview (styles: also reifyui/styles/file.css)
//
// Styles: reifyui/styles/agent-chat.css. A separate entry so a host that renders a Button never
// pulls in a conversation, and so nothing here changes what the root ChatMessages/ChatPanel do.
export { newTurn, reduceTurn, finish, turnFromEvents, turnFromResponse, turnFromHistory, turnFromMessage,
  liveState, segments, latestPlan, isTerminal } from './turn.js';
export { describeTool, toolKind, toolLine, summarizeCalls, resultNote, parseToolArgs, todosOf, diffOf, patchStats,
  commandText, baseNameOf, lineCount, browserActOf, browserElements } from './tools.js';
export { formatElapsed, formatDuration, formatTokens, useElapsed, useNow } from './time.js';
export { MARK_MOTIONS, MOTIONS, motionFor } from './marks.js';
export { AgentConversation, AgentTurnView, WorkGroup, StepRow, ThinkingRow, TodoCard, WorkingIndicator, WorkingMark,
  StreamingText, TurnOutcome, UserBubble, AgentComposer, CopyButton, DiffBadge, LinesBlock, useStickToBottom,
  DEFAULT_AGENT_LABELS } from './components.jsx';
// the files a turn made: cards in the conversation (FileCard), opened beside it (ArtifactPanel)
export { ArtifactPanel, FileSwitcher, MidName, middleEllipsis } from './artifacts.jsx';
export { FileCard } from '../components/FileCard.jsx';
export { FilePreview } from '../components/FilePreview.jsx';
