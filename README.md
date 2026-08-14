# ReifyUI

### The rendering & interaction layer for agentic applications.

Bring your own components or use ours. ReifyUI lets any agent stream, render, and drive
**application-native** interfaces — and lets users act back on them — across any model and any
agent framework.

**Model-agnostic. Framework-agnostic. Design-system-native.**

_Reify_ — to make the abstract concrete. ReifyUI reifies an agent's intent into UI.

```bash
npm install reifyui
```

> **Status: v0.4, early.** ReifyUI is an open foundation, not a finished platform. This first
> release line ships the rendering-and-interaction core described under **Today** below. The larger
> vision — a component registry, agent-driven composition, and protocol interop — is on the
> **Roadmap**, stated plainly so you can tell what runs now from what's coming. We don't ship
> vaporware in the feature list.

---

## Why ReifyUI

The generative-UI space is splitting into layers that get lumped together: component toolkits
(Tambo), generated-experience APIs (Thesys), chat-first UI frameworks (assistant-ui), agent
frontend stacks (CopilotKit), and emerging **standards** for what an agent may render — A2UI,
AG-UI, MCP Apps.

ReifyUI's bet is the layer none of them fully own: a **beautiful, production component runtime**
that is neutral about your model, your agent framework, and the wire protocol — and that adapts
to *your* application's design system rather than imposing its own. Not another chat widget; the
surface every agent product renders through.

- **Model-agnostic** — parses the OpenAI-style Responses/SSE event shape today; the renderer
  cares about events, not who produced them.
- **Framework-agnostic** — plain React + peer deps, no runtime lock-in, no hosted service required.
- **Design-system-native** — CSS-variable theming you own; components inherit your look, not ours.
- **Standards-friendly** — built to *support* A2UI / AG-UI / MCP Apps as they land, not to compete
  with them (Roadmap).

---

## Today — what actually ships

A production-grade surface for rendering and interacting with a live agent turn:

| Area | Exports |
|---|---|
| **Streaming** | `pumpResponsesStream`, `createResponsesDispatcher`, `readSSEStream` — parse the Responses SSE event shape into ordered blocks |
| **Block state** | `withText`, `withReasoning`, `withStep`, `withResult`, `asstText`, `createConversationStore` — session-continuation state machine |
| **Chat surface** | `ChatMessages`, `UserTurn`, `AssistantTurn`, `ToolGroup`, `ToolRow`, `Composer` — message list + a collapsible "ran 5 commands, wrote a file" tool-step timeline |
| **Chat panel** | `ChatPanel` — the whole conversation column beside a document: history replay, the live turn, connecting-and-retry, attachments, dictation, composer. You supply `runTurn` and `loadHistory`; it owns everything else. `turnsToMessages`, `createDictation`, `bytesLabel` |
| **Library page** | `Carousel`, `Card`, `Chip`, `SearchField`, `Popover`, `Modal`, `useTypewriter` — the surface a document product opens on: a prompt box, a strip of templates, the things you already made |
| **Rich blocks** | `CodeBlock` (highlight.js + mermaid + charts), `useResizablePane`, `PaneResizer` |
| **Task list** | `TaskList`, `taskStatusGroup` — the master list beside a conversation: live status, filtering, cursor pagination. Transport-agnostic: you supply `fetchPage(cursor)` |
| **Dialogs** | `DialogHost`, `useDialog` — awaited in-app `alert` / `confirm` / `prompt`, so a destructive tool call or a "name this" step never falls back to a browser popup |
| **Slides** (`reifyui/slides`) | `SlideView`, `SlideStage`, `EditorCanvas`, `Presentation`, `ElementView`, `themeVars` — render a JSON deck, edit it by direct manipulation, present it |
| **Spreadsheet** | `SheetGrid`, `sheetToDelimited`, `sheetToAoA` — an AI-editable grid, extensible with your own column types |
| **HarnessRouter** (`reifyui/harness`) | `configureKit`, `kitHarness`, `listSessions`, `readFile`, `writeFile`, `createResponse`, `streamTurn`, `turnsToMessages`, `fileToInputBlock` — the transport for apps served by a HarnessRouter console |
| **Icons / tool meta** | `Ic*` icon set, `toolMeta`, `humanize`, `summarizeSteps` |
| **Auth (optional)** | `configureAuth`, `login`, `AuthForm`, `GoogleButton` — a thin JWT client for products with a `/v1/auth`-style backend; wired to nothing by default |

Extracted from production agent products and hardened there. Full TypeScript definitions ship
with the package.

## Roadmap — the layer we're building toward

Stated as intent, not shipped features:

- **Component registry + bring-your-own** — register your React components (with schemas); let an
  agent select, populate, and update them, in or out of chat.
- **Agent-driven composition** — declarative component trees resolved by name against an approved
  allowlist (safe generative UI), not free-form HTML.
- **Bidirectional state & actions** — a shared state channel agents and UI both read/write, with
  human-in-the-loop approvals and frontend tool calls.
- **Protocol interop** — first-class **A2UI**, **AG-UI**, and **MCP Apps** support, so ReifyUI is
  the best renderer for the standards rather than a rival to them.
- **Design-system adaptation** — map generated intent onto your tokens/components automatically.
- **Beyond web** — web first, native renderers after.

Issues and RFCs for these are welcome.

---

## Quick start

Render a live agent turn from a Server-Sent-Events response:

```jsx
import { useState } from 'react';
import { ChatMessages, Composer, pumpResponsesStream } from 'reifyui';
import 'reifyui/styles/chat.css';
import 'reifyui/styles/themes/light.css'; // or themes/dark.css

// You own the conversation array. ReifyUI renders it — text, reasoning, and a collapsible
// tool-step timeline — and never decides how you fetch or where your state lives.
export function Chat({ endpoint }) {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);

  const amendLast = (patch) =>
    setMessages((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, ...patch(x) } : x)));

  async function send(text) {
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '', steps: [] }]);
    setBusy(true);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: text, stream: true }),
    });
    await pumpResponsesStream(res.body, {
      onTextDelta: (d) => amendLast((x) => ({ text: x.text + d })),
      onReasoningDelta: (d) => amendLast((x) => ({ reasoning: (x.reasoning || '') + d })),
      onToolCall: (name, args, callId) =>
        amendLast((x) => ({ steps: [...x.steps, { name, args, callId }] })),
      onToolResult: (callId, output) =>
        amendLast((x) => ({ steps: x.steps.map((s) => (s.callId === callId ? { ...s, output } : s)) })),
      onDone: () => setBusy(false),
      onError: () => setBusy(false),
    });
  }

  return (
    <>
      <ChatMessages messages={messages} workingLabel={busy ? 'Working…' : undefined} />
      <Composer onSend={send} disabled={busy} />
    </>
  );
}
```

Peer dependencies: `react` and `react-dom` (>=18). The rich blocks are **optional** — install them
only if you use them: `highlight.js` (code), `mermaid` (diagrams), `echarts` (charts). If you don't
import a feature, it adds nothing to your bundle.

## Styling

CSS ships as plain files you import where you want them — nothing is injected for you:

```js
import 'reifyui/styles/chat.css';          // chat surface + tool steps + composer + ChatPanel
import 'reifyui/styles/themes/light.css';  // light theme variables
import 'reifyui/styles/themes/dark.css';   // dark theme variables
import 'reifyui/styles/library.css';       // shell, hero, prompt box, carousel, card, table
import 'reifyui/styles/chip.css';          // Chip + Popover
import 'reifyui/styles/preview.css';       // Modal
import 'reifyui/styles/slides.css';        // slides
import 'reifyui/styles/sheet.css';         // spreadsheet grid
import 'reifyui/styles/tasks.css';         // task list
import 'reifyui/styles/dialog.css';        // alert / confirm / prompt dialogs
```

Themes are CSS-variable files — load one, or switch at runtime by toggling which you apply. Override
the variables to match your design system. Every stylesheet reads the same `--uic-*` set, dialogs
included, so setting `--uic-brand` once moves the conversation, the grid, the focus glow and the
dialog buttons together.

## Chat panel

`ChatMessages` renders a conversation. `ChatPanel` is the whole column around it — the part every
product rebuilds and every rebuild gets slightly wrong. It owns the conversation's state machine;
you own the transport and the words.

```jsx
import { ChatPanel, createDictation, turnsToMessages } from 'reifyui';
import { sessionTurns, fileToInputBlock } from 'reifyui/harness';
import 'reifyui/styles/chat.css';

<ChatPanel
  sessionId={id}                          // opaque — never parsed, so a placeholder id is fine
  loadHistory={(sid) => sessionTurns(sid).then(turnsToMessages)}
  runTurn={({ sessionId, text, attachments, handlers }) =>
    runMyTurn(sessionId, text, handlers, attachments.map((a) => a.payload))}
  onSessionStarted={adopt}                // the first turn opened a session: take its id
  externalBusy={agentIsRunning}           // a turn started elsewhere — poll, don't show a blank prompt
  attachments={{ prepare: fileToInputBlock }}
  dictation={createDictation()}           // null where the browser has no recogniser -> no mic
  title={doc.title}
  placeholder="What should this do?"
  emptyState={<YourEmptyState />}
/>
```

`runTurn` resolves `{ connecting: true }` when the backend is not up yet: the panel then holds the
message — with its files — and retries, instead of showing a turn that failed. Everything else it
learns through `handlers`, which are the streaming dispatcher's own callbacks.

## Slides

A deck is JSON — a fixed 1920×1080 stage, and elements with absolute frames and stable ids. That
makes it something an agent can author and patch precisely, and something you can render, edit and
present from the same components.

Imported from **`reifyui/slides`**, not the root: chart, diagram and code elements lazy-load
echarts, mermaid and highlight.js, and a root re-export would put all three in the dependency graph
of every app that imports a `Button`.

```jsx
import { SlideView, EditorCanvas, Presentation } from 'reifyui/slides';
import 'reifyui/styles/slides.css';

// Read-only: thumbnails, previews, print pages.
<SlideView slide={deck.slides[0]} theme={deck.theme} bare />

// Editable: drag to move, corner handles to resize, double-click to edit text,
// Delete to remove, arrows to nudge. The canvas never mutates the deck — you do.
<EditorCanvas
  slide={deck.slides[i]}
  theme={deck.theme}
  selectedId={selected}
  onSelect={setSelected}
  onPatchElement={(id, patch) => setDeck((d) => patchElement(d, i, id, patch))}
  onDeleteElement={(id) => setDeck((d) => removeElement(d, i, id))}
  readOnly={agentIsWriting}
/>
```

Because every commit leaves as a typed patch, undo, autosave and collaboration stay where they
belong — with the host. Pass `peers` to draw other people's selections and live drags, and
`onDragState` to broadcast your own. `resolveSrc` rewrites element `src` values on the way out, so
workspace-relative image paths can point at your own file API.

## Spreadsheet

`SheetGrid` renders a sheet JSON and calls back for edits. Its column vocabulary is a prop, so a
host adds a column kind without forking the component:

```jsx
import { SheetGrid } from 'reifyui';
import 'reifyui/styles/sheet.css';

const COLUMN_TYPES = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  // `computed` means the app fills these cells: status dot, tint, run affordances.
  { type: 'agent', label: 'Agent', computed: true, configKey: 'agent',
    badge: (col) => col.agent?.name },
];

<SheetGrid
  sheet={sheet}
  onChange={setSheet}
  columnTypes={COLUMN_TYPES}
  // Own a cell's body. Return undefined to fall through to the built-in rendering.
  renderCell={({ column, cell, runCell }) =>
    (column.type === 'agent' ? <AgentCell cell={cell} onRun={runCell} /> : undefined)}
  // Own the column popover's body, below the Type select. applyPatch commits and closes.
  renderColumnConfig={({ type, column, columns, applyPatch }) =>
    (type === 'agent' ? <AgentConfig column={column} columns={columns} onApply={applyPatch} /> : undefined)}
/>
```

`sheetToDelimited(sheet, sep, { cellText })` and `sheetToAoA(sheet, { cellText })` export the grid;
pass `cellText` so a custom column exports as something a person wants rather than as raw JSON.

All colours come from `--uic-*` tokens — apply `styles/themes/light.css` or `dark.css`, or set the
same tokens in your own layer.

## Optional: auth client

ReifyUI includes a small, framework-agnostic auth client for products whose backend exposes a JSON
`/v1/auth`-style API (login / register / Google SSO / org switch, JWT in `localStorage`). It is
optional and **not** wired to any hosted service — you point it at your own backend:

```js
import { configureAuth, login } from 'reifyui';
configureAuth({ product: 'myapp', engine: 'https://api.example.com' }); // required, once at boot
```

## License

MIT © Epsilla
