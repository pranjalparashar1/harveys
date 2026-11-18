import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { stampJs, stampHtml } from '../scripts/stamp.mjs';

test('every element app.js looks up exists in index.html', () => {
  // 1.3.2 shipped with a lookup of a removed element and the scan crashed on iPhone.
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ids = [...new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length > 10);
  assert.deepEqual(ids.filter((id) => !html.includes(`id="${id}"`)), []);
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
  assert.match(out, /src="src\/app\.js\?v=b1"/);
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
