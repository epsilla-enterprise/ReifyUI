// A cell shows all of its value: the text wraps, the row fits its tallest cell up to a cap, and a
// cell with more than the cap scrolls inside itself. A row someone sized is exactly that tall.
// The fit itself is the browser's table layout, so what is checked here is what feeds it: the
// markup each row gets, and the rules in styles/sheet.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { SheetGrid } from '../src/sheet/SheetGrid.jsx';

// esbuild bundles this file into .test-out/, one level down from the package like test/ is.
const css = readFileSync(new URL('../styles/sheet.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const m = new RegExp(`(^|\\n)${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(css);
  assert.ok(m, `no rule for ${sel}`);
  return m[2].replace(/\s+/g, ' ');
};

const sheet = {
  meta: { title: 'T' },
  columns: [{ id: 'c', name: 'Notes', type: 'text' }, { id: 'u', name: 'Site', type: 'url' }],
  rows: [{ id: 'free' }, { id: 'sized', height: 120 }],
  cells: {
    'free:c': { value: 'first line\nsecond line' },
    'free:u': { value: 'example.com/a/path/with/no/spaces/at/all' },
  },
};
const rowTag = (html, id) => {
  const m = new RegExp(`<tr data-row-id="${id}"[^>]*>`).exec(html);
  assert.ok(m, `no row ${id}`);
  return m[0];
};

test('a row with no height of its own carries none, so the table fits it to its content', () => {
  const tr = rowTag(renderToStaticMarkup(<SheetGrid sheet={sheet} />), 'free');
  assert.doesNotMatch(tr, /[;"]height:/);
  assert.doesNotMatch(tr, /--shg-row-max/);
});

test('a row someone sized is that tall, and that height is its cells\' cap', () => {
  const tr = rowTag(renderToStaticMarkup(<SheetGrid sheet={sheet} />), 'sized');
  assert.match(tr, /height:120px/);
  assert.match(tr, /--shg-row-max:119px/);
});

test('a value reaches the page with its own line breaks', () => {
  const html = renderToStaticMarkup(<SheetGrid sheet={sheet} readOnly />);
  assert.match(html, /<span class="shg-val-txt">first line\nsecond line<\/span>/);
});

test('text wraps, keeps its line breaks and breaks a long word, and is never clamped', () => {
  const txt = rule('.shg-val-txt');
  assert.match(txt, /white-space: pre-wrap/);
  assert.match(txt, /overflow-wrap: anywhere/);
  assert.doesNotMatch(txt, /line-clamp|text-overflow|nowrap/);
});

test('the value box stops at the cap and scrolls past it', () => {
  const val = rule('.shg-val');
  assert.match(val, /max-height: var\(--shg-row-max, calc\(8 \* 18px \+ 12px\)\)/);
  assert.match(val, /overflow-y: auto/);
  assert.doesNotMatch(val, /height: 100%/, 'a box stretched to the row would hide what sizes it');
});

test('links and option pills wrap like any other value', () => {
  for (const sel of ['.shg-link', '.shg-pill']) {
    assert.doesNotMatch(rule(sel), /nowrap|text-overflow: ellipsis/, sel);
  }
  assert.match(rule('.shg-link'), /overflow-wrap: anywhere/);
});

test('the editor lies over its cell, so the copy of the draft under it holds the row', () => {
  assert.match(rule('.shg-input'), /position: absolute; inset: 0;/);
  assert.match(rule('.shg-val-mirror'), /visibility: hidden/);
  assert.match(rule('.shg-input-area'), /white-space: pre-wrap; overflow-wrap: anywhere;/);
});
