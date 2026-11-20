// v2 Step 4: the 30-dish blind benchmark. Draws 12 catalogue meals (the ones pranjal has
// no verdict on yet; makhana is out of Pierre), 8 macro hacks and 10 absurd combos from
// the top couvert tier (audit/repro/couvert.mjs → top.mjs, 4.5 spoons). Writes the blind
// sheet src/quiz/benchmark.json (names and parts only, no scores) and the hidden key, which
// stays out of the repo: Pierre's computed tier, why, and the couvert spoons.
//   node scripts/benchmark.mjs couvert.json key.json [seed]
import { readFileSync, writeFileSync } from 'node:fs';
import { CATALOGUE } from '../src/brain/catalogue.js';
import { PIERRE_SEED } from '../src/brain/train-data.js';
import { MODIFIERS, pierreTier, techKey } from '../src/brain/ingredients.js';
import { TABLE_KITCHEN, modifiersOf } from './pierre-tiers.mjs';

export const SEED = 20261121;
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (list, rng) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Macro hacks: protein first, effort last, real things people do. Walnuts are here on
// purpose: the almond/walnut centre-1 crunch flag (Step 3 watch-out) needs a dish to show on.
export const HACKS = [
  { id: 'hack_whey_water', name: 'Whey shaken with water', form: 'shake', parts: [{ id: 'whey', technique: 'shake_water' }], modifiers: [] },
  { id: 'hack_curd_whey', name: 'Curd with a scoop of whey stirred in', form: 'bowl', parts: [{ id: 'curd' }, { id: 'whey' }], modifiers: [] },
  { id: 'hack_micro_paneer', name: 'Microwaved paneer cubes, salt and pepper', form: 'bowl', parts: [{ id: 'paneer', technique: 'microwaved' }], modifiers: ['salt', 'black_pepper'] },
  { id: 'hack_egg_hung_curd', name: 'Boiled eggs mashed into hung curd', form: 'bowl', parts: [{ id: 'eggs', technique: 'boiled' }, { id: 'hung_curd' }], modifiers: ['salt', 'black_pepper'] },
  { id: 'hack_banana_pb_walnut', name: 'Banana with peanut butter and walnuts', form: 'bowl', parts: [{ id: 'banana' }, { id: 'peanut_butter' }, { id: 'walnuts' }], modifiers: [] },
  { id: 'hack_soya_air', name: 'Air-fried soya chunks with chaat masala', form: 'bowl', parts: [{ id: 'soya_chunks', technique: 'air_fried' }], modifiers: ['chaat_masala'] },
  { id: 'hack_kala_chana', name: 'Sautéed kala chana with onion and lemon', form: 'bowl', parts: [{ id: 'kala_chana', technique: 'sauteed' }, { id: 'onion' }, { id: 'lemon' }], modifiers: ['salt', 'chaat_masala'] },
  { id: 'hack_overnight_oats', name: 'Raw oats soaked in milk with whey', form: 'bowl', parts: [{ id: 'oats' }, { id: 'milk' }, { id: 'whey' }], modifiers: [] },
];

// "paneer (pan fried)" → { id: 'paneer', technique: 'pan_fried' }; "garlic*" → a condiment.
export function parseCombo(name) {
  const parts = [];
  const modifiers = [];
  for (const seg of name.split(' + ')) {
    if (seg.endsWith('*')) { modifiers.push(seg.slice(0, -1).trim().replace(/ /g, '_')); continue; }
    const m = /^(.+?)(?: \((.+)\))?$/.exec(seg.trim());
    parts.push({ id: m[1].replace(/ /g, '_'), ...(m[2] ? { technique: m[2].replace(/ /g, '_') } : {}) });
  }
  return { parts, modifiers };
}

const words = (id) => id.replace(/_/g, ' ');
const TECH_WORD = { air_fried: 'air-fried', pan_fried: 'pan-fried', deep_fried: 'deep-fried', fried_egg: 'fried', shake_water: 'shaken with water', shake_milk: 'shaken with milk', pressure_cooked: 'pressure-cooked' };
export const partLabel = (p) => (p.technique ? `${words(p.id)} (${TECH_WORD[p.technique] ?? words(p.technique)})` : words(p.id));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildBenchmark(absurdRows, seed = SEED) {
  const rng = mulberry32(seed);
  const meals = CATALOGUE.filter((m) => !PIERRE_SEED[m.id] && !m.parts.some((p) => p.id === 'makhana'));
  const real = shuffle(meals, rng).slice(0, 12).map((m) => ({
    id: m.id, source: 'catalogue', name: m.name, form: m.form, parts: m.parts,
    modifiers: modifiersOf(m).filter((id) => MODIFIERS[id] || id === 'garlic'),
  }));
  // Absurd: the 4.5-spoon tier, at most one combo per food set once tomato is set aside.
  const top = absurdRows.filter((x) => x.spoons === Math.max(...absurdRows.map((r) => r.spoons)));
  const seen = new Set();
  const absurd = [];
  for (const row of shuffle(top, rng)) {
    const key = row.foods.filter((f) => f !== 'tomato').sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    const { parts, modifiers } = parseCombo(row.name);
    absurd.push({ id: `combo_${absurd.length + 1}`, source: 'absurd', name: cap([...parts.map(partLabel), ...modifiers.map(words)].join(', ')), form: 'open', parts, modifiers, couvert: row.spoons });
    if (absurd.length === 10) break;
  }
  const hacks = HACKS.map((h) => ({ ...h, source: 'hack' }));
  const dishes = shuffle([...real, ...hacks, ...absurd], rng);
  const key = dishes.map((d) => {
    const t = pierreTier(d.parts, d.form, { modifiers: d.modifiers, inventory: TABLE_KITCHEN });
    return {
      id: d.id, source: d.source, name: d.name, form: d.form, parts: d.parts.map((p) => techKey(p.id, p.technique)), modifiers: d.modifiers,
      computed: t.computed, why: t.why, upgrade: t.upgrade?.add ?? null, untested: t.untested,
      unrated: [...(t.profile?.unscored ?? []), ...d.modifiers.filter((m) => !MODIFIERS[m])], ...(d.couvert != null ? { couvert: d.couvert } : {}),
    };
  });
  const sheet = {
    id: 'benchmark', title: 'Pierre benchmark', version: 1, seed,
    tiers: [
      { id: 'veto', label: 'Veto', line: 'I wouldn’t eat this.' },
      { id: 'floor', label: 'Floor', line: 'Edible, but it’s missing something. Not worth making as it is.' },
      { id: 'pass', label: 'Pass', line: 'I’d happily eat this.' },
      { id: 'crave', label: 'Crave', line: 'I’d want this again. I’d go out of my way for it.' },
    ],
    // Optional, for veto and floor: what's off. Settles the per-dimension report and umami.
    reasons: [
      { id: 'bland', label: 'Bland' },
      { id: 'savoury', label: 'Lacks savoury depth' },
      { id: 'texture', label: 'Texture is off' },
      { id: 'clash', label: 'Doesn’t go together' },
      { id: 'cooking', label: 'Cooked wrong / raw' },
      { id: 'meal', label: 'Not a meal' },
    ],
    dishes: dishes.map((d) => ({ id: d.id, name: d.name, parts: cap([...d.parts.map(partLabel), ...d.modifiers.map(words)].join(', ')) })),
  };
  return { sheet, key };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [couvert, keyOut, seed] = process.argv.slice(2);
  if (!couvert || !keyOut) throw new Error('usage: node scripts/benchmark.mjs couvert.json key.json [seed]');
  const { sheet, key } = buildBenchmark(JSON.parse(readFileSync(couvert, 'utf8')), seed ? Number(seed) : SEED);
  writeFileSync(new URL('../src/quiz/benchmark.json', import.meta.url), `${JSON.stringify(sheet, null, 2)}\n`);
  writeFileSync(keyOut, `${JSON.stringify(key, null, 2)}\n`);
  const n = (s) => key.filter((k) => k.source === s).length;
  console.log(`benchmark: ${key.length} dishes (${n('catalogue')} catalogue, ${n('hack')} hacks, ${n('absurd')} absurd)`);
  for (const k of key) console.log(`${k.computed.padEnd(5)} ${k.source.padEnd(9)} ${k.name}  [${k.why.join('; ')}]`);
}
