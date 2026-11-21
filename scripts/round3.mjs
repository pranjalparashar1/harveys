// Round 3: the third blind sheet (21 Nov 2026). Steps 4b and 5 were shaped on both earlier sheets,
// so these dishes are new to Pierre. Only pranjal's round-3 pantry: spices salt, sugar, chilli
// flakes, oregano, chaat masala, black pepper (no other masalas: pranjal adds those as
// improvements); lemon, coriander, mint, curd; tomato sauce, chilli sauce, mayo; olive oil, ghee,
// butter; milk, cream; honey; Maggi (cooked with its masala), whey (chocolate), cocoa; and the
// common foods. Mint, the condiments and Maggi carry Claude's estimated profiles until rated.
// Hung curd is out. Writes src/quiz/round3.json and the hidden key (keep it out of the repo).
//   node scripts/round3.mjs key.json [seed]
import { writeFileSync } from 'node:fs';
import { buildSheet } from './holdout.mjs';

export const ROUND3_SEED = 20261123;
const P = (s) => s.split(',').map((x) => { const [id, technique] = x.trim().split('@'); return technique ? { id, technique } : { id }; });
const M = (s) => (s ? s.split(',') : []);
// [id, source, probe, name, form, parts, modifiers]. probe = which rule or new ingredient it tests.
const ROWS = [
  ['r3_maggi', 'instant', 'Maggi as a dish', 'Maggi cooked with its masala', 'one-pot', 'maggi@boiled', ''],
  ['r3_maggi_cheese', 'instant', 'melted cheese on a base', 'Maggi cooked with its masala, a cheese slice melted in', 'one-pot', 'maggi@boiled,cheese_slices@melted', ''],
  ['r3_maggi_egg', 'instant', 'protein on an instant base', 'Maggi cooked with its masala, an egg fried in butter on top', 'one-pot', 'maggi@boiled,eggs@fried_egg,butter', ''],
  ['r3_pasta_ketchup', 'combo', 'condiment as a sauce', 'Boiled pasta tossed with tomato sauce (ketchup) and oregano', 'open', 'pasta@boiled', 'tomato_sauce,oregano,salt'],
  ['r3_aglio_olio', 'everyday', 'flavoured fat coats a base', 'Pasta aglio olio: garlic and chilli flakes in olive oil', 'coated_base', 'pasta@boiled,garlic@sauteed', 'olive_oil,chilli_flakes,salt'],
  ['r3_pomodoro', 'everyday', 'simmered tomato is a sauce', 'Pasta with tomato simmered down in olive oil with garlic and oregano', 'coated_base', 'pasta@boiled,tomato@simmered,garlic@sauteed', 'olive_oil,oregano,salt'],
  ['r3_cream_pasta', 'combo', 'cream as a sauce', 'Boiled pasta tossed in warm cream as the sauce, a cheese slice melted in, black pepper', 'coated_base', 'pasta@boiled,cream,cheese_slices@melted', 'black_pepper,salt'],
  ['r3_paneer_mint_curd', 'hack', 'fresh herb + hot/cold', 'Paneer pan-fried in ghee, with cold curd, mint and black pepper', 'bowl', 'paneer@pan_fried,ghee,curd', 'mint,black_pepper,salt'],
  ['r3_egg_mayo_sandwich', 'everyday', 'mayo as the bridge', 'Egg mayo sandwich: boiled eggs mashed with mayo, in toasted bread', 'sandwich', 'bread@toasted,eggs@boiled', 'mayo,black_pepper,salt'],
  ['r3_paneer_mayo_sandwich', 'everyday', 'condiments, raw onion on a cooked base', 'Toasted sandwich: paneer pan-fried in butter, raw onion, mayo and chilli sauce spread inside', 'sandwich', 'bread@toasted,paneer@pan_fried,butter,onion', 'mayo,chilli_sauce'],
  ['r3_cheese_toast_oregano', 'hack', 'dried herb', 'Cheese toast with oregano and chilli flakes', 'toast', 'bread@toasted,cheese_slices@melted', 'oregano,chilli_flakes'],
  ['r3_garlic_bread', 'everyday', 'toast with no topping', 'Garlic bread: garlic sautéed in butter, spread on toasted bread with oregano', 'toast', 'bread@toasted,butter,garlic@sauteed', 'oregano,salt'],
  ['r3_omelette_ketchup', 'everyday', 'condiment on a protein', 'Omelette cooked in butter, tomato sauce on the side', 'griddle', 'eggs@omelette,butter', 'tomato_sauce,black_pepper,salt'],
  ['r3_scrambled_toast', 'everyday', 'pepper boundary', 'Eggs scrambled in butter, on toast with salt and pepper', 'toast', 'bread@toasted,eggs@scrambled,butter', 'black_pepper,salt'],
  ['r3_egg_bhurji', 'everyday', 'sautéed tomato as a mix-in', 'Egg bhurji: onion, tomato and eggs cooked in butter, coriander and chilli flakes', 'bhurji', 'eggs@scrambled,onion@sauteed,tomato@sauteed,butter,coriander', 'chilli_flakes,salt'],
  ['r3_paneer_bhurji', 'everyday', 'sautéed tomato as a mix-in', 'Paneer bhurji: onion, tomato and crumbled paneer cooked in ghee, coriander and black pepper', 'bhurji', 'paneer@scrambled,onion@sauteed,tomato@sauteed,ghee,coriander', 'black_pepper,salt'],
  ['r3_fried_rice', 'everyday', 'tadka coats rice', 'Egg fried rice: rice, spring onion and egg stir-fried in olive oil, chilli sauce tossed through', 'coated_base', 'rice@sauteed,eggs@scrambled,spring_onion@sauteed', 'olive_oil,chilli_sauce,salt'],
  ['r3_chilli_soya', 'combo', 'condiments as the sauce', 'Chilli soya: soya chunks, onion and capsicum sautéed in olive oil, tossed in chilli sauce and tomato sauce', 'open', 'soya_chunks@sauteed,onion@sauteed,capsicum@sauteed', 'olive_oil,chilli_sauce,tomato_sauce,salt'],
  ['r3_dal_rice', 'everyday', 'dal as the sauce, lemon', 'Dal and rice with ghee stirred in and a squeeze of lemon', 'one-pot', 'rice@pressure_cooked,dal@pressure_cooked,ghee,lemon', 'salt'],
  ['r3_aloo_chaat', 'everyday', 'cold chaat on a cooked part', 'Aloo chaat: boiled potato with raw onion, tomato, coriander, lemon and chaat masala', 'bowl', 'potato@boiled,onion,tomato,coriander,lemon', 'chaat_masala'],
  ['r3_potato_mayo', 'hack', 'one part + condiment', 'Potato air-fried with no oil, salt and chilli flakes, mayo on the side as a dip', 'bowl', 'potato@air_fried', 'mayo,chilli_flakes,salt'],
  ['r3_mushroom_cream_toast', 'combo', 'a sauce as the topping', 'Creamy mushroom toast: mushrooms and garlic sautéed in butter, finished with cream, on toast', 'toast', 'bread@toasted,mushroom@sauteed,garlic@sauteed,butter,cream', 'black_pepper,salt'],
  ['r3_choc_shake', 'hack', 'chocolate whey, cocoa', 'Chocolate whey shaken with milk, banana and cocoa', 'shake', 'whey@shake_milk,banana', 'cocoa_powder'],
  ['r3_cocoa_oats', 'hack', 'sweet base, no whey', 'Microwaved oats with milk, banana, cocoa and honey', 'bowl', 'oats@microwaved,milk,banana', 'cocoa_powder,honey'],
  ['r3_fruit_curd', 'hack', 'sweet curd bowl', 'Curd with apple, banana and a little sugar', 'bowl', 'curd,apple,banana', 'sugar'],
  ['r3_raita', 'hack', 'no anchor (a side)', 'Cucumber raita with mint and salt', 'bowl', 'curd,cucumber', 'mint,salt'],
];
export const ROUND3 = ROWS.map(([id, source, probe, name, form, parts, mods]) => ({ id, source, probe, name, form, parts: P(parts), modifiers: M(mods) }));

if (import.meta.url === `file://${process.argv[1]}`) {
  const [keyOut, seed] = process.argv.slice(2);
  if (!keyOut) throw new Error('usage: node scripts/round3.mjs key.json [seed]');
  const { sheet, key } = buildSheet(ROUND3, seed ? Number(seed) : ROUND3_SEED, 'round3', 'Pierre round 3');
  writeFileSync(new URL('../src/quiz/round3.json', import.meta.url), `${JSON.stringify(sheet, null, 2)}\n`);
  writeFileSync(keyOut, `${JSON.stringify(key, null, 2)}\n`);
  const n = (s) => key.filter((k) => k.computed === s).length;
  console.log(`round 3: ${key.length} dishes; Pierre: ${n('veto')} veto, ${n('floor')} floor, ${n('pass')} pass`);
  for (const k of key) console.log(`${k.computed.padEnd(5)} ${k.source.padEnd(9)} ${k.name}  [${k.why.join('; ')}]${k.unrated.length ? ` unrated: ${k.unrated.join(', ')}` : ''}`);
}
