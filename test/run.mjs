// The package's tests: Node's own runner, with esbuild (already here through tsup) compiling the JSX.
// Each test/*.test.jsx is bundled on its own (React stays external, the app's single copy) into
// .test-out/ and run there. `npm test`. Backported from 0.14.0, with 0.8's own peers external.
import { build } from 'esbuild';
import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '.test-out');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = readdirSync(here).filter((f) => /\.test\.(m?jsx?)$/.test(f));
await build({
  entryPoints: files.map((f) => join(here, f)),
  outdir: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  outExtension: { '.js': '.mjs' },
  external: ['react', 'react-dom', 'react/*', 'react-dom/*', 'node:*', 'highlight.js', 'highlight.js/*', 'mermaid', 'echarts', 'echarts/*', 'react-file-icon'],
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, ['--test', ...files.map((f) => join(out, f.replace(/\.m?jsx?$/, '.mjs')))], { stdio: 'inherit' });
process.exit(r.status ?? 1);
