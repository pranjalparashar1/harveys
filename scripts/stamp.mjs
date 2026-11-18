// Cache-busting for GitHub Pages. Pages serves every file with a 10-minute
// cache, so a phone could run a new index.html with an old app.js (or old CSS)
// and crash. This gives every page-loaded file a URL unique to the build:
//   node scripts/stamp.mjs <site dir> <build id>
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Adds ?v=<build> to relative import specifiers in one JS source. */
export function stampJs(src, build) {
  return src.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g, `$1$2$3?v=${build}$2`);
}

/** Adds ?v=<build> to the page's own stylesheet and script, and records the build. */
export function stampHtml(src, build) {
  return src
    .replace(/(href|src)="((?:assets|src)\/[^"?]+\.(?:css|js))"/g, `$1="$2?v=${build}"`)
    .replace(/<html([^>]*)>/, `<html$1 data-build="${build}">`);
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, build] = process.argv.slice(2);
  if (!dir || !/^[\w.-]+$/.test(build ?? '')) throw new Error('usage: stamp.mjs <dir> <build id>');
  const html = join(dir, 'index.html');
  writeFileSync(html, stampHtml(readFileSync(html, 'utf8'), build));
  const js = walk(join(dir, 'src')).filter((p) => p.endsWith('.js'));
  for (const p of js) writeFileSync(p, stampJs(readFileSync(p, 'utf8'), build));
  console.log(`stamped index.html and ${js.length} modules with v=${build}`);
}
