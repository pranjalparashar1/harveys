import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { stampJs, stampHtml } from '../scripts/stamp.mjs';

// 1.3.2 shipped with a lookup of a removed element and the scan crashed on iPhone.
// 1.60.0: the home page (index.html) runs src/home.js; the taste test (rate.html) runs src/app.js.
for (const [script, page] of [['home.js', 'index.html'], ['app.js', 'rate.html']]) {
  test(`every element ${script} looks up exists in ${page}`, () => {
    const js = readFileSync(new URL(`../src/${script}`, import.meta.url), 'utf8');
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const ids = [...new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]))];
    assert.ok(ids.length > 10);
    assert.deepEqual(ids.filter((id) => !html.includes(`id="${id}"`)), []);
    assert.match(html, new RegExp(`<script type="module" src="src/${script.replace('.', '\\.')}"></script>`));
  });
}

test('every page is deployed: the Pages workflow copies each .html file', () => {
  const yml = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const cp = /cp -r ([^\n]+) _site\//.exec(yml)?.[1].split(/\s+/) ?? [];
  const pages = readdirSync(new URL('../', import.meta.url)).filter((f) => f.endsWith('.html'));
  assert.ok(pages.includes('rate.html'));
  assert.deepEqual(pages.filter((f) => !cp.includes(f)), []);
});

test('an old tester link on the home page leaves for rate.html before anything loads', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const head = html.slice(0, html.indexOf('<link rel="stylesheet"'));
  assert.match(head, /location\.replace\('rate\.html' \+ location\.hash\)/);
});

test('stamping versions relative imports and leaves the rest alone', () => {
  const src = "import { a } from './brain/index.js';\nimport x from \"../y.js\";\nconst m = await import('./z.js');\nimport 'https://cdn/x.js';";
  const out = stampJs(src, 'abc123');
  assert.match(out, /'\.\/brain\/index\.js\?v=abc123'/);
  assert.match(out, /"\.\.\/y\.js\?v=abc123"/);
  assert.match(out, /'\.\/z\.js\?v=abc123'/);
  assert.match(out, /'https:\/\/cdn\/x\.js'/);
  assert.equal(stampJs(out, 'abc123'), out, 'already-stamped specifiers are not stamped twice');
});

test('stamping the page versions its stylesheet and script', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const out = stampHtml(html, 'b1');
  assert.match(out, /href="assets\/styles\.css\?v=b1"/);
  assert.match(out, /src="src\/home\.js\?v=b1"/);
  assert.match(out, /href="assets\/home\.css\?v=b1"/);
  assert.match(out, /data-build="b1"/);
  assert.match(out, /href="assets\/fonts\/poppins-latin-500-normal\.woff2"/, 'fonts keep stable URLs');
});

test('every module the page loads is imported relatively, so stamping reaches it', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) assert.match(m[1], /^\.{1,2}\//, `${f} imports ${m[1]}`);
  }
});
