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

> **Status: v0.1, early.** ReifyUI is an open foundation, not a finished platform. This first
> release ships the rendering-and-interaction core described under **Today** below. The larger
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

## Today (v0.1) — what actually ships

A production-grade surface for rendering and interacting with a live agent turn:

| Area | Exports |
|---|---|
| **Streaming** | `pumpResponsesStream`, `createResponsesDispatcher`, `readSSEStream` — parse the Responses SSE event shape into ordered blocks |
| **Block state** | `withText`, `withReasoning`, `withStep`, `withResult`, `asstText`, `createConversationStore` — session-continuation state machine |
| **Chat surface** | `ChatMessages`, `UserTurn`, `AssistantTurn`, `ToolGroup`, `ToolRow`, `Composer` — message list + a collapsible "ran 5 commands, wrote a file" tool-step timeline |
| **Rich blocks** | `CodeBlock` (highlight.js + mermaid + charts), `useResizablePane`, `PaneResizer` |
| **Task list** | `TaskList`, `taskStatusGroup` — the master list beside a conversation: live status, filtering, cursor pagination. Transport-agnostic: you supply `fetchPage(cursor)` |
| **Slides** | a slide renderer/editor + `reifyui/styles/slides.css` |
| **Spreadsheet** | `SheetGrid`, `sheetToDelimited`, `sheetToAoA` — an AI-editable grid |
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
import { ChatMessages, Composer, createConversationStore, pumpResponsesStream } from 'reifyui';
import 'reifyui/styles/chat.css';
import 'reifyui/styles/themes/light.css'; // or themes/dark.css

const store = createConversationStore();

export function Chat({ endpoint }) {
  const [, force] = useState(0);
  store.subscribe(() => force((n) => n + 1));

  async function send(text) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: text, stream: true }),
    });
    await pumpResponsesStream({ response: res, store });
  }

  return (
    <>
      <ChatMessages store={store} />
      <Composer onSend={send} placeholder="Ask anything…" />
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
import 'reifyui/styles/chat.css';          // chat surface + tool steps + composer
import 'reifyui/styles/themes/light.css';  // light theme variables
import 'reifyui/styles/themes/dark.css';   // dark theme variables
import 'reifyui/styles/slides.css';        // slides
import 'reifyui/styles/sheet.css';         // spreadsheet grid
import 'reifyui/styles/tasks.css';         // task list
```

Themes are CSS-variable files — load one, or switch at runtime by toggling which you apply. Override
the variables to match your design system.

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
