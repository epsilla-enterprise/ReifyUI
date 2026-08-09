// Fenced code block with language-aware syntax highlighting (highlight.js core).
//
// Consumers wire this into their markdown renderer's `pre` override (see the ChatPanel /
// workbench MD_COMPONENTS): a ```mermaid fence keeps rendering as a diagram; every other fence
// renders here. Design notes (same lazy pattern as the Mermaid block):
//   - highlight.js is LAZY-loaded (dynamic import) — the core plus exactly one small grammar
//     chunk per language actually used, never the full-language bundle. Until it loads the block
//     renders as plain <pre><code>, byte-identical geometry, so there is no layout shift.
//   - Highlighting is DEBOUNCED: while a fence is still streaming in token by token we render
//     plain text and re-arm the timer; the block highlights once it settles. hljs itself never
//     throws on partial input, the debounce just avoids re-lexing on every token.
//   - Unknown / missing language: NO auto-detect, render plain. Wrong-language colors are worse
//     than none.
//   - `gremlin` maps to the groovy grammar (Gremlin is a Groovy DSL — closest match).
//   - Colors are token-driven: .wbx-code maps hljs classes onto five --uic-code-* custom
//     properties (keyword/string/comment/number/function) with defaults tuned for the dark
//     code-block background. See styles/chat.css + README "Theming".
// highlight.js must be a dependency of the CONSUMING app (the dynamic import resolves in its
// bundler) — same rule as mermaid.
import React from 'react';

let _hljsPromise = null;
function loadHljs() {
  if (!_hljsPromise) {
    _hljsPromise = import('highlight.js/lib/core').then((m) => m.default || m);
  }
  return _hljsPromise;
}

// One static dynamic-import per grammar so each becomes its own code-split chunk and only the
// languages that actually appear in a conversation ever download.
const GRAMMARS = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  python: () => import('highlight.js/lib/languages/python'),
  json: () => import('highlight.js/lib/languages/json'),
  bash: () => import('highlight.js/lib/languages/bash'),
  sql: () => import('highlight.js/lib/languages/sql'),
  java: () => import('highlight.js/lib/languages/java'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
};

// Fence-tag aliases → canonical grammar name.
const ALIASES = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  html: 'xml', xhtml: 'xml', svg: 'xml',
  yml: 'yaml',
  golang: 'go',
  rs: 'rust',
  jsonc: 'json',
  postgres: 'sql', postgresql: 'sql', mysql: 'sql', plsql: 'sql',
  gremlin: 'groovy',
};

function canonicalLang(tag) {
  const t = String(tag || '').toLowerCase();
  if (!t) return null;
  const name = ALIASES[t] || t;
  return GRAMMARS[name] ? name : null;
}

// canonical name -> Promise<hljs | null> (null = load failed; stay plain forever, never retry-loop)
const _ready = new Map();
function ensureLanguage(name) {
  if (!_ready.has(name)) {
    const p = Promise.all([loadHljs(), GRAMMARS[name]()])
      .then(([hljs, mod]) => {
        if (!hljs.getLanguage(name)) hljs.registerLanguage(name, mod.default || mod);
        return hljs;
      })
      .catch(() => null);
    _ready.set(name, p);
  }
  return _ready.get(name);
}

export function CodeBlock(props) {
  const { code, language, className } = props;
  const src = String(code || '');
  const lang = canonicalLang(language);
  const [hl, setHl] = React.useState(null); // { src, html } — html valid only for exactly that src

  React.useEffect(() => {
    if (!lang || !src) return undefined;
    let cancelled = false;
    // Debounce: during streaming the fence grows every few ms — wait for a quiet gap, then
    // highlight the settled source. hljs output is fully HTML-escaped (safe to inject).
    const timer = setTimeout(() => {
      ensureLanguage(lang).then((hljs) => {
        if (!hljs || cancelled) return;
        try {
          const out = hljs.highlight(src, { language: lang, ignoreIllegals: true });
          if (!cancelled) setHl({ src, html: out.value });
        } catch {
          /* stay plain */
        }
      });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [src, lang]);

  const html = hl && hl.src === src ? hl.html : null;
  const label = String(language || '').toLowerCase();
  return (
    <pre className={'wbx-code' + (className ? ' ' + className : '')}>
      {label ? <span className="wbx-code-lang" aria-hidden="true">{label}</span> : null}
      {html != null
        ? <code className={'hljs language-' + label} dangerouslySetInnerHTML={{ __html: html }} />
        : <code className={label ? 'language-' + label : undefined}>{src}</code>}
    </pre>
  );
}
