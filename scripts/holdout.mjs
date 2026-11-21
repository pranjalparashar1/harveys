// Step 4c: the holdout sheet. Step 4b's rules were shaped from the 30 benchmark answers, so
// this tests them on dishes Pierre has never been rated on: everyday dishes (the catalogue
// has no unseen meal left, makhana aside), macro hacks, and open combos built to probe the
// new rules, above all passes that sit on the boundary (drop one spice and Pierre floors
// them) and the sauté-vs-sauce cases (boiled pasta or noodles with sautéed tomato).
// Names say how a dish is put together, since the Step 4 combos gave no arrangement.
// Writes the blind sheet src/quiz/holdout.json and the hidden key (keep it out of the repo).
//   node scripts/holdout.mjs key.json [seed]
import { writeFileSync } from 'node:fs';
import { pierreTier, techKey, MODIFIERS } from '../src/brain/ingredients.js';
import { TABLE_KITCHEN } from './pierre-tiers.mjs';
import { buildBenchmark, partLabel } from './benchmark.mjs';

export const HOLDOUT_SEED = 20261122;
const P = (s) => s.split(',').map((x) => { const [id, technique] = x.trim().split('@'); return technique ? { id, technique } : { id }; });
const M = (s) => (s ? s.split(',') : []);
// [id, source, probe, name, form, parts, modifiers]. probe = which rule the dish tests.
const ROWS = [
  ['ho_bread_omelette', 'everyday', 'boundary: pepper', 'Bread omelette: butter omelette in toasted bread', 'sandwich', 'bread@toasted,eggs@omelette,butter', 'salt,black_pepper'],
  ['ho_masala_egg_toast', 'everyday', 'boundary: green chilli', 'Masala scrambled eggs on toast', 'toast', 'bread@toasted,eggs@scrambled,onion@sauteed', 'salt,green_chilli'],
  ['ho_tomato_rice', 'everyday', 'sauté vs sauce (real dish)', 'Tomato rice: rice sautéed with tomato and onion', 'one-pot', 'rice@sauteed,tomato@sauteed,onion@sauteed', 'salt,red_chilli_powder'],
  ['ho_aloo_bhurji', 'everyday', 'boundary: chilli powder', 'Aloo bhurji: pan-fried potato with sautéed onion', 'bhurji', 'potato@pan_fried,onion@sauteed', 'salt,red_chilli_powder'],
  ['ho_curd_rice', 'everyday', 'pass', 'Curd rice', 'bowl', 'rice@pressure_cooked,curd', 'salt'],
  ['ho_dal_roti', 'everyday', 'fat alone (khichdi-like)', 'Dal with roti and ghee', 'open', 'dal@pressure_cooked,roti,ghee', 'salt'],
  ['ho_mushroom_toast', 'everyday', 'boundary: pepper', 'Garlic mushroom toast', 'toast', 'bread@toasted,mushroom@sauteed,butter,garlic@sauteed', 'salt,black_pepper'],
  ['ho_paneer_onion_sandwich', 'everyday', 'sharp raw veg', 'Air-fried paneer sandwich with raw onion', 'sandwich', 'bread@toasted,paneer@air_fried,onion', 'salt,chaat_masala'],
  ['ho_paneer_chilli', 'hack', 'boundary: chilli flakes', 'Pan-fried paneer with salt and chilli flakes', 'bowl', 'paneer@pan_fried', 'salt,chilli_flakes'],
  ['ho_hung_curd_banana', 'hack', 'one texture', 'Hung curd with banana and honey', 'bowl', 'hung_curd,banana', 'honey'],
  ['ho_egg_lemon', 'hack', 'pass (acid)', 'Boiled eggs with lemon and chaat masala', 'bowl', 'eggs@boiled,lemon', 'salt,chaat_masala'],
  ['ho_potato_butter', 'hack', 'boundary: pepper', 'Microwaved potato with butter, salt and pepper', 'bowl', 'potato@microwaved,butter', 'salt,black_pepper'],
  ['ho_apple_pb', 'hack', 'no anchor', 'Apple slices with peanut butter', 'bowl', 'apple,peanut_butter', ''],
  ['ho_mango_curd', 'hack', 'pass (sweet)', 'Mango with curd', 'bowl', 'mango,curd', ''],
  ['ho_kala_chana_salad', 'hack', 'pass (acid, raw veg)', 'Sautéed kala chana with raw tomato, cucumber and lemon', 'bowl', 'kala_chana@sauteed,tomato,cucumber,lemon', 'salt,chaat_masala'],
  ['ho_pasta_tomato', 'combo', 'sauté vs sauce', 'Boiled pasta tossed with sautéed tomato and salt', 'open', 'pasta@boiled,tomato@sauteed', 'salt'],
  ['ho_noodles_tomato_onion', 'combo', 'sauté vs sauce', 'Boiled noodles tossed with sautéed tomato and onion, chilli flakes', 'open', 'noodles@boiled,tomato@sauteed,onion@sauteed', 'salt,chilli_flakes'],
  ['ho_pasta_tomato_cheese', 'combo', 'sauté vs sauce', 'Boiled pasta tossed with sautéed tomato and garlic, cheese melted on top', 'open', 'pasta@boiled,tomato@sauteed,garlic@sauteed,cheese_slices@melted', 'salt'],
  ['ho_pasta_butter_pepper', 'combo', 'boundary: pepper', 'Boiled pasta with butter, salt and black pepper', 'open', 'pasta@boiled,butter', 'salt,black_pepper'],
  ['ho_rice_peas_butter', 'combo', 'fat alone', 'Sautéed rice with boiled peas and butter', 'open', 'rice@sauteed,frozen_peas@boiled,butter', 'salt'],
  ['ho_paneer_capsicum', 'combo', 'idle part', 'Pan-fried paneer with sautéed capsicum and onion', 'open', 'paneer@pan_fried,capsicum@sauteed,onion@sauteed', 'salt,red_chilli_powder'],
  ['ho_raw_peas', 'combo', 'cook-first', 'Paneer cubes with raw frozen peas and tomato', 'open', 'paneer,frozen_peas,tomato', 'salt,black_pepper'],
];
export const HOLDOUT = ROWS.map(([id, source, probe, name, form, parts, mods]) => ({ id, source, probe, name, form, parts: P(parts), modifiers: M(mods) }));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const words = (id) => id.replace(/_/g, ' ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const buildHoldout = (seed = HOLDOUT_SEED) => buildSheet(HOLDOUT, seed, 'holdout', 'Pierre holdout');

/** A blind sheet (shuffled by seed) and its hidden key, for any list of dishes. */
export function buildSheet(rows, seed, id, title) {
  const rng = mulberry32(seed);
  const dishes = [...rows];
  for (let i = dishes.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [dishes[i], dishes[j]] = [dishes[j], dishes[i]]; }
  const tierOf = (parts, mods, form) => pierreTier(parts, form, { modifiers: mods, inventory: TABLE_KITCHEN }).computed;
  const key = dishes.map((d) => {
    const t = pierreTier(d.parts, d.form, { modifiers: d.modifiers, inventory: TABLE_KITCHEN });
    // A pass on the boundary: dropping one modifier floors it.
    const boundary = t.computed === 'pass' ? d.modifiers.filter((m) => tierOf(d.parts, d.modifiers.filter((x) => x !== m), d.form) !== 'pass') : [];
    return {
      id: d.id, source: d.source, probe: d.probe, name: d.name, form: d.form, parts: d.parts.map((p) => techKey(p.id, p.technique)), modifiers: d.modifiers,
      computed: t.computed, why: t.why, upgrade: t.upgrade?.add ?? null, untested: t.untested,
      unrated: [...(t.profile?.unscored ?? []), ...d.modifiers.filter((m) => !MODIFIERS[m])], boundary,
    };
  });
  // The same tiers, reasons and Fix-it cookings as the Step 4 sheet.
  const { tiers, reasons, techniques } = buildBenchmark([{ spoons: 0, foods: [], name: 'x' }]).sheet;
  const sheet = {
    id, title, version: 1, seed, tiers, reasons, techniques,
    dishes: dishes.map((d) => ({
      id: d.id, name: d.name, parts: cap([...d.parts.map(partLabel), ...d.modifiers.map(words)].join(', ')),
      items: [...d.parts.map((p) => ({ id: p.id, ...(p.technique ? { technique: p.technique } : {}) })), ...d.modifiers.map((id) => ({ id, mod: true }))],
    })),
  };
  return { sheet, key };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [keyOut, seed] = process.argv.slice(2);
  if (!keyOut) throw new Error('usage: node scripts/holdout.mjs key.json [seed]');
  const { sheet, key } = buildHoldout(seed ? Number(seed) : HOLDOUT_SEED);
  writeFileSync(new URL('../src/quiz/holdout.json', import.meta.url), `${JSON.stringify(sheet, null, 2)}\n`);
  writeFileSync(keyOut, `${JSON.stringify(key, null, 2)}\n`);
  const n = (s) => key.filter((k) => k.computed === s).length;
  console.log(`holdout: ${key.length} dishes; Pierre: ${n('veto')} veto, ${n('floor')} floor, ${n('pass')} pass (${key.filter((k) => k.boundary.length).length} on the boundary)`);
  for (const k of key) console.log(`${k.computed.padEnd(5)} ${k.source.padEnd(9)} ${k.name}  [${k.why.join('; ')}]${k.boundary.length ? ` boundary: -${k.boundary.join(' -')}` : ''}`);
}
