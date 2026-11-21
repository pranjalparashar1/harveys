#!/usr/bin/env node
// Imports kitchens catalogued from video and ranks each one with Harvey's brain.
//
//   node scripts/import-kitchens.mjs <kitchens.json> [more.json …] [--classify] [--save]
//
//   --classify  asks Gemini flash-lite (GEMINI_API_KEY from the environment) to profile the
//               names nothing else knows, and caches the answers in data/ingredient-cache.json.
//               Without it, unknown names are listed and still join the kitchen as plain extras.
//   --save      writes each kitchen to data/kitchens/<slug>.json (items buildInventory reads).
//
// The key is read from the environment only and is never written anywhere.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CATALOGUE, buildInventory, rank, importKitchens, classifyPrompt, parseClassification, labelFor, RUNGS } from '../src/brain/index.js';
import { slug } from '../src/brain/pantry.js';

const CACHE_FILE = new URL('../data/ingredient-cache.json', import.meta.url);
const MODEL = 'gemini-3.5-flash-lite'; // flash-lite only (pranjal's rule)
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node scripts/import-kitchens.mjs <kitchens.json> [--classify] [--save]');
  process.exit(1);
}
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* first run */ }

const kitchens = files.flatMap((f) => importKitchens(readFileSync(f, 'utf8')));
const unknown = [...new Set(kitchens.flatMap((k) => buildInventory(k.items, { cache }).unmatched))];

if (args.includes('--classify') && unknown.length) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('--classify needs GEMINI_API_KEY in the environment');
    process.exit(1);
  }
  for (let i = 0; i < unknown.length; i += 40) {
    const batch = unknown.slice(i, i + 40);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: classifyPrompt(batch) }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 } }),
    });
    if (!res.ok) {
      console.error(`flash-lite ${res.status}: ${(await res.text()).slice(0, 200)}`);
      break;
    }
    const body = await res.json();
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    Object.assign(cache, parseClassification(text));
  }
  writeFileSync(CACHE_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 1)}\n`);
  console.log(`cached ${Object.keys(cache).length} classifications in data/ingredient-cache.json\n`);
}

const TARGETS = { protein: 60, calories: 1200, fiber: 20 };
for (const k of kitchens) {
  const inv = buildInventory(k.items, { cache });
  const r = rank({ inventory: inv, targets: TARGETS, context: { hour: 19, weekday: 3, kind: 'any' }, catalogue: CATALOGUE });
  console.log(`## ${k.kitchen}  (${k.diet}${k.notes ? `; ${k.notes}` : ''})`);
  console.log(`   ${inv.matched.length} known, ${inv.extras.filter((e) => !e.as).length} extras, ${inv.unmatched.length} unknown${inv.excluded.length ? `, ${inv.excluded.length} non-veg left out` : ''}`);
  const extras = inv.extras.filter((e) => !e.as);
  if (extras.length) console.log(`   extras: ${extras.map((e) => `${e.name}${e.roles.length ? ` [${e.roles.join(' ')}]` : ''}`).join(', ')}`);
  if (inv.unmatched.length) console.log(`   unknown (try --classify): ${inv.unmatched.join(', ')}`);
  for (const rung of r.ladder) console.log(`   ${rung.rung} ${RUNGS[rung.rung]}: ${rung.pick.meal.name} (${rung.pick.pierre.tier})`);
  if (!r.ladder.length) console.log(`   nothing cookable. Unlocks: ${r.unlocks.map((u) => labelFor(u.id)).join(', ') || 'none'}`);
  console.log('');
  if (args.includes('--save')) {
    mkdirSync(new URL('../data/kitchens/', import.meta.url), { recursive: true });
    writeFileSync(new URL(`../data/kitchens/${slug(k.kitchen)}.json`, import.meta.url), `${JSON.stringify(k, null, 1)}\n`);
  }
}
