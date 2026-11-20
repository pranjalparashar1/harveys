// Pulls a Pierre-trainer "Send to Marco" export into Marco's brain file.
//   node scripts/ingest-pierre.mjs export.txt      (or pipe the text in)
//   node scripts/ingest-pierre.mjs --exclude spinach,okra   (set foods aside)
//   node scripts/ingest-pierre.mjs --centre whey=4,eggs=3    (centre of a prep-only food)
//   node scripts/ingest-pierre.mjs --merge dal=moong_dal+toor_dal   (several foods become one)
//   node scripts/ingest-pierre.mjs --class dense_starchy=paneer+bread   (food class, Step 3)
// A retest export is refused: compare it with scripts/retest-report.mjs instead.
// Rewrites src/brain/pierre-raw.js. Newer ratings of the same food win.
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePayload, isRetest } from '../src/quiz/quiz.js';
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
  const ce = args.indexOf('--centre');
  const centres = ce >= 0 ? Object.fromEntries(args.splice(ce, 2)[1].split(',').map((s) => s.trim().split('=')).map(([k, v]) => [k, Number(v)])) : {};
  const me = args.indexOf('--merge');
  const merges = me >= 0 ? Object.fromEntries(args.splice(me, 2)[1].split(',').map((s) => s.trim().split('=')).map(([k, v]) => [k, v.split('+')])) : {};
  const cl = args.indexOf('--class');
  const classes = cl >= 0 ? Object.fromEntries(args.splice(cl, 2)[1].split(',').map((s) => s.trim().split('=')).map(([k, v]) => [k, v.split('+')])) : {};
  const flagsOnly = exclude.length || Object.keys(centres).length || Object.keys(merges).length || Object.keys(classes).length;
  const text = args[0] || !flagsOnly ? readFileSync(args[0] ?? 0, 'utf8') : '';
  if (text && isRetest(text)) throw new Error('that is a retest export: run scripts/retest-report.mjs on it; retests never change the brain');
  const ratings = text ? decodePayload(text) : {};
  const n = Object.keys(ratings).length;
  if (!n && !flagsOnly) throw new Error('no ratings found in that text');
  const kb = mergeRatings(PIERRE_RAW, ratings, { exclude, centres, merges, classes });
  writeFileSync(FILE, renderBrainFile(kb));
  console.log(`ingested ${n} foods; the brain file now has ${Object.keys(kb.foods).length}`);
}
