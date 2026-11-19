// Pulls a Pierre-trainer "Send to Marco" export into Marco's brain file.
//   node scripts/ingest-pierre.mjs export.txt      (or pipe the text in)
//   node scripts/ingest-pierre.mjs --exclude spinach,okra   (set foods aside)
// Rewrites src/brain/pierre-raw.js. Newer ratings of the same food win.
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePayload } from '../src/quiz/quiz.js';
import { mergeRatings } from '../src/brain/ingredients.js';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';

const FILE = new URL('../src/brain/pierre-raw.js', import.meta.url);

export function renderBrainFile(kb) {
  const src = readFileSync(FILE, 'utf8');
  const head = src.slice(0, src.indexOf('export const PIERRE_RAW'));
  return `${head}export const PIERRE_RAW = ${JSON.stringify(kb, null, 2).replace(/"(\w+)":/g, '$1:').replace(/"/g, "'")};\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ex = args.indexOf('--exclude');
  const exclude = ex >= 0 ? args.splice(ex, 2)[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  const ratings = args[0] || !exclude.length ? decodePayload(readFileSync(args[0] ?? 0, 'utf8')) : {};
  const n = Object.keys(ratings).length;
  if (!n && !exclude.length) throw new Error('no ratings found in that text');
  const kb = mergeRatings(PIERRE_RAW, ratings, { exclude });
  writeFileSync(FILE, renderBrainFile(kb));
  console.log(`ingested ${n} foods; the brain file now has ${Object.keys(kb.foods).length}`);
}
