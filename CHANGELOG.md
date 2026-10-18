# Changelog

## 0.15.0

- `ChatPanel` takes `view="agent"` (with `mark`, `motion`, `agentLabels`): each turn drawn by
  reifyui/agent-chat's `AgentTurnView`, the live line with the harness's mark, work folded per run of
  calls. Needs `styles/agent-chat.css` beside `styles/chat.css`. Without the prop nothing changes.
- `streamTurn` (reifyui/harness) calls `handlers.onEvent(event)` with every event, whole, as it
  arrives; ChatPanel folds those into the turn's clock, so the agent view times its calls.

## 0.14.0

New entry `reifyui/agent-chat` (styles: `reifyui/styles/agent-chat.css`). Nothing in the root entry
or any other entry changes.

- `AgentTurnView`: one agent turn. Prose streams in with its newest words fading in; the work between
  two pieces of prose folds to one past-tense line ("Ran 2 commands, edited app.ts +3 −1", "1 failed"),
  which opens to every call; each call opens to its input (the command, the diff, `key: value` lines)
  and its output, each with Copy and a "+N lines" expander. A failed call shows its error line
  without a click. Thinking reads "Thinking" while it streams and "Thought for 6s" after. The latest
  plan (TodoWrite, update_plan, write_todos, todowrite, SetTodoList …) renders once, as a card.
  The turn ends in "Worked for 1m 4s · 12.3k tokens", "Stopped after 12s", or "Failed" with the reason.
- `WorkingIndicator` / `WorkingMark`: the live line, `[mark] 2s · Thinking`, where the mark is the
  harness's own logo (passed as a node) in one of 15 CSS motions (`bloom`, `sheen`, `glint`,
  `flutter`, `glide`, `blink`, `flip`, `swim`, `spin`, `wave`, `dash`, `scuttle`, `equalize`, `bob`,
  `pulse`), or three jostling dots without a mark. `motionFor(base)` / `MARK_MOTIONS` choose one per
  harness. Every motion and shimmer stops under `prefers-reduced-motion`.
- `AgentComposer`: autogrowing box, attach (button, drop, paste), attachment chips, left and right
  slots, Send that becomes Stop while a task runs (Enter does not start a second turn).
- `AgentConversation`: the column, with its dock (composer, notice) pinned to the bottom, `pane` or
  `page` mode, following the bottom while the reader is there and offering "Jump to latest" when
  they are not. `useStickToBottom` on its own.
- The data: `newTurn`, `reduceTurn(turn, event, at)` (Responses stream events, the broadcast feed's
  `harness.turn.started`, `error`), `finish`, `turnFromEvents`, `turnFromResponse`, `turnFromHistory`,
  `turnFromMessage`, `liveState`, `segments`, `latestPlan`. Times come only from the `at` a caller
  passes for a live event; a replay passes null and gets no durations.
- The words: `describeTool`, `toolKind`, `toolLine`, `summarizeCalls`, `resultNote`, `todosOf`,
  `diffOf`, `patchStats`, `commandText`, covering the tool names of Claude Code, Codex, Gemini CLI,
  Hermes, Goose, OpenCode, OpenHands, pi, Kimi and connected (MCP) tools.
- `npm test`: the package now has tests (Node's runner, JSX compiled by esbuild).
