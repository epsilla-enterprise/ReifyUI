import { defineConfig } from 'tsup';

// ReifyUI ships compiled ESM + CJS. Source is plain-ESM React (.js/.jsx) using the
// automatic JSX runtime, so not every file imports React — esbuild injects the
// react/jsx-runtime import for us and React stays external (the app's single copy).
//
// Types are hand-authored in src/index.d.ts (the source is JSX, not TS, so there is
// nothing to infer from) and copied to dist by the onSuccess step.
export default defineConfig({
  entry: { index: 'src/index.js' },
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
  onSuccess: 'cp src/index.d.ts dist/index.d.ts',
});
