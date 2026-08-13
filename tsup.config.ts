import { defineConfig } from 'tsup';

// ReifyUI ships compiled ESM + CJS. Source is plain-ESM React (.js/.jsx) using the
// automatic JSX runtime, so not every file imports React — esbuild injects the
// react/jsx-runtime import for us and React stays external (the app's single copy).
//
// Types are hand-authored in src/index.d.ts (the source is JSX, not TS, so there is
// nothing to infer from) and copied to dist by the onSuccess step.
export default defineConfig({
  // `slides` is a SEPARATE entry, not part of the root index, and that is deliberate: the deck
  // renderer lazy-loads echarts / mermaid / highlight.js for chart, diagram and code elements.
  // Re-exporting it from the root would put those three in the dependency graph of every app that
  // imports a Button. Consumers reach it at `reifyui/slides`.
  // `harness` is a separate entry for a different reason than `slides`: it is not a renderer
  // at all but the HarnessRouter transport, useful only to apps the HarnessRouter console
  // serves. Keeping it out of the root means importing a Button never pulls in a fetch layer
  // for an API you do not run. Consumers reach it at `reifyui/harness`.
  entry: { index: 'src/index.js', slides: 'src/slides/index.js', harness: 'src/harness/index.js' },
  format: ['esm', 'cjs'],
  target: 'es2020',
  platform: 'browser',
  sourcemap: true,
  clean: true,
  // Every runtime dependency is a peer the host app already owns — never bundle them.
  external: [/^react($|\/)/, /^react-dom($|\/)/, /^highlight\.js($|\/)/, 'mermaid', 'echarts'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  onSuccess: 'cp src/index.d.ts dist/index.d.ts && cp src/slides/index.d.ts dist/slides.d.ts && cp src/harness/index.d.ts dist/harness.d.ts',
});
