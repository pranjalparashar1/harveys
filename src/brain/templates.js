// Open-slot templates (1.54.0, pranjal 24 Nov: "option C"). The catalogue's dishes are no longer
// the only dishes: each one is a template whose slots any item of the same kind can fill, so a
// kitchen with mushrooms gets air-fried mushroom tikka and mushroom bhurji without anyone
// writing them. Every variant goes through the same rank(): checkMeal, Pierre's tiers and vetoes,
// Marco's friction from its (rewritten) steps. Nothing here decides; it only proposes.
//
// Two ways a template opens:
//   swap   a slot's food is replaced by a kitchen item of the same SWAP group, cooked the same way
//          (paneer@air_fried → mushroom@air_fried). Only when Pierre has rated the new food that
//          way (or raw, for a raw slot), so an unrated pairing never reaches a tester.
//   add    one extra vegetable joins a form that takes one (bhurji, omelette, poha, chaat…), with
//          its own prep step, again only if Pierre has rated it in that state.
//
// 1.56.0 (pranjal, 26 Nov): tofu is gone (it stood in for paneer and testers rated the same
// aglio olio 5★ with paneer, 2★ with tofu), and with it the stand-in (`proxy`) mechanism it was
// the only user of. Soya chunks are never swapped into or out of a dish (NEVER_SWAP); the soya
// dishes as written stay.
//
// pranjal's hard rules hold on every variant: never microwave eggs, dal or legumes; tadka goes in
// oil or ghee (templates already say so, and swaps never touch the fat). Vegetarian plus eggs.
// Every number here is an ESTIMATE (per serving), not a rating. Pure: no DOM, no network.

import { PIERRE_RAW } from './pierre-raw.js';

/** Foods that are never microwaved (pranjal): eggs, dal and legumes. */
export const NEVER_MICROWAVE = new Set(['eggs', 'dal', 'chickpeas', 'rajma', 'kala_chana', 'sprouts']);
/** Foods no swap ever takes out of a dish or puts into one (pranjal, 26 Nov: soya always rates low). */
export const NEVER_SWAP = new Set(['soya_chunks']);
/**
 * Foods that boil alone, never in the same water as anything else (pranjal, 26 Nov): soya
 * chunks boiled with pasta or rice flavour it, and can't be fished out to squeeze. A recipe
 * boils them first, drains and squeezes them, then boils the base in fresh water; Marco counts
 * the extra boil. test/soya-boil.test.js holds every dish, written or opened, to it.
 */
export const BOIL_ALONE = Object.freeze(['soya_chunks']);

// A member: pierre = the id Pierre tastes; have = inventory tokens that mean this food;
// word = how steps and names call it; prep = PREP_KINDS for its slot; macros per serving (ESTIMATE).
const F = (pierre, word, have, prep, macros, extra = {}) => ({ pierre, word, have: [pierre, ...have], prep, macros, ...extra });
const MEMBERS = {
  paneer: F('paneer', 'paneer', [], 'cut', { protein: 18, kcal: 265, fiber: 0 }),
  mushroom: F('mushroom', 'mushroom', ['x:mushroom', 'x:mushrooms', 'x:button_mushrooms'], 'cut', { protein: 4, kcal: 35, fiber: 2 }),
  potato: F('potato', 'potato', ['x:potato', 'x:potatoes'], 'peel_chop', { protein: 4, kcal: 160, fiber: 4 }),
  banana: F('banana', 'banana', [], 'peel', { protein: 1, kcal: 105, fiber: 3 }),
  apple: F('apple', 'apple', ['x:apple', 'x:apples'], 'cut', { protein: 0, kcal: 95, fiber: 4 }),
  mango: F('mango', 'mango', ['x:mango', 'x:mangoes'], 'cut', { protein: 1, kcal: 100, fiber: 3 }),
  pomegranate: F('pomegranate', 'pomegranate', ['x:pomegranate'], 'peel', { protein: 2, kcal: 70, fiber: 3 }),
  peanuts: F('peanuts', 'peanuts', [], 'measure', { protein: 5, kcal: 115, fiber: 2 }),
  almonds: F('almonds', 'almonds', ['x:almonds'], 'measure', { protein: 4, kcal: 115, fiber: 2 }),
  walnuts: F('walnuts', 'walnuts', ['x:walnuts'], 'measure', { protein: 3, kcal: 130, fiber: 1 }),
  cashews: F('cashews', 'cashews', ['x:cashews', 'x:kaju'], 'measure', { protein: 4, kcal: 110, fiber: 1 }),
  tomato: F('tomato', 'tomato', [], 'cut', { protein: 1, kcal: 20, fiber: 1 }),
  cucumber: F('cucumber', 'cucumber', [], 'cut', { protein: 1, kcal: 15, fiber: 1 }),
  capsicum: F('capsicum', 'capsicum', [], 'cut', { protein: 1, kcal: 25, fiber: 2 }),
  carrot: F('carrot', 'carrot', ['x:carrot', 'x:carrots'], 'peel_chop', { protein: 1, kcal: 25, fiber: 2 }),
  onion: F('onion', 'onion', [], 'peel_chop', { protein: 1, kcal: 40, fiber: 1 }),
  spring_onion: F('spring_onion', 'spring onion', [], 'cut', { protein: 1, kcal: 10, fiber: 1 }),
  cabbage: F('cabbage', 'cabbage', ['x:cabbage'], 'cut', { protein: 1, kcal: 20, fiber: 2 }),
  sweet_corn: F('sweet_corn', 'sweet corn', [], 'measure', { protein: 3, kcal: 85, fiber: 2 }),
  frozen_peas: F('frozen_peas', 'peas', [], 'measure', { protein: 4, kcal: 60, fiber: 4 }),
};

/**
 * Swap groups: foods that fill the same slot the same way. A slot opens only for the techniques
 * listed (paneer@microwaved stays paneer: Pierre has no microwaved mushroom).
 */
export const SWAPS = [
  { id: 'cubes', members: ['paneer', 'mushroom', 'potato'], techniques: ['air_fried', 'pan_fried', 'sauteed', null] },
  { id: 'fruit', members: ['banana', 'apple', 'mango', 'pomegranate'], techniques: [null] },
  { id: 'nuts', members: ['peanuts', 'almonds', 'walnuts', 'cashews'], techniques: [null, 'roasted'] },
  { id: 'raw_veg', members: ['tomato', 'cucumber', 'capsicum', 'carrot', 'onion'], techniques: [null] },
];

/** Forms that take one extra vegetable, and the state it goes in. */
export const ADD_ONS = {
  bhurji: { technique: 'sauteed', members: ['capsicum', 'mushroom', 'spring_onion', 'tomato', 'onion', 'cabbage'] },
  griddle: { technique: 'sauteed', members: ['capsicum', 'spring_onion', 'tomato', 'onion', 'mushroom'] },
  chaat_salad: { technique: null, members: ['cucumber', 'tomato', 'onion', 'capsicum', 'carrot'] },
  coated_base: { technique: 'sauteed', members: ['capsicum', 'spring_onion', 'cabbage', 'mushroom', 'onion'] },
};
/** Templates whose form takes an add-on only when they already cook something on a stove. */
const ADD_NEEDS_PAN = new Set(['bhurji', 'griddle', 'coated_base']);
/** Most variants one template gives (swaps first, then one add-on). */
export const MAX_VARIANTS = 3;

const ratedAs = (food, technique, kb) => (technique ? Boolean(kb.tech?.[`${food}@${technique}`]) : Boolean(kb.foods?.[food]));
const memberOf = (food) => Object.entries(MEMBERS).find(([, m]) => m.pierre === food)?.[0] ?? null;
const ownedToken = (m, have) => m.have.find((t) => have.has(t)) ?? null;
const KNIFE = new Set(['cut', 'peel_chop']);
/** A template written knife-free stays knife-free: "(no chopping)" dishes are for kitchens without a board. */
const usesKnife = (meal) => meal.ingredients.some((i) => KNIFE.has(i.prep)) || (meal.utensils ?? []).includes('knife');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Words a step or name uses for a food: its own word plus its singular/plural forms. */
function wordsFor(m) {
  const w = m.word;
  return [...new Set([w, w.replace(/s$/, ''), `${w}s`, m.pierre.replace(/_/g, ' ')])].sort((a, b) => b.length - a.length);
}
function swapText(text, from, to) {
  let out = String(text ?? '');
  for (const w of wordsFor(from)) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (re.test(out)) return out.replace(re, (hit) => (hit[0] === hit[0].toUpperCase() ? cap(to.word) : to.word));
  }
  return out;
}

/** The kitchen's food ids as Pierre names them, for "already in the dish" checks. */
const partIds = (meal) => new Set((meal.parts ?? []).map((p) => p.id));

/**
 * Every variant the kitchen opens for one template, each a full catalogue-shaped dish.
 * `have` is inventory.have. Deterministic: members are tried in SWAPS order.
 */
export function variantsOf(meal, have, kb = PIERRE_RAW) {
  const out = [];
  const inside = partIds(meal);
  // ── swaps ──
  for (const part of meal.parts ?? []) {
    if (NEVER_SWAP.has(part.id)) continue;
    const group = SWAPS.find((g) => g.members.some((k) => MEMBERS[k].pierre === part.id) && g.techniques.includes(part.technique ?? null));
    if (!group) continue;
    const fromKey = memberOf(part.id);
    // Wedges are a cut of potato, not a slot: paneer wedges aren't a dish.
    if (fromKey === 'potato') continue;
    const from = MEMBERS[fromKey];
    const ing = meal.ingredients.find((i) => (i.anyOf ?? [i.id]).includes(part.id));
    if (!ing) continue;
    for (const key of group.members) {
      if (key === fromKey || out.length >= MAX_VARIANTS) continue;
      const to = MEMBERS[key];
      if (inside.has(to.pierre) || NEVER_SWAP.has(to.pierre)) continue;
      const token = ownedToken(to, have);
      if (!token) continue;
      if (part.technique === 'microwaved' && NEVER_MICROWAVE.has(to.pierre)) continue;
      if (KNIFE.has(to.prep) && !KNIFE.has(ing.prep) && !usesKnife(meal)) continue;
      if (!ratedAs(to.pierre, part.technique, kb)) continue;
      out.push(swapVariant(meal, part, ing, from, to, token, key));
    }
  }
  // ── one add-on ──
  const add = ADD_ONS[meal.form];
  const usesPan = (meal.equipment ?? []).some((e) => ['pan', 'pot', 'stovetop'].includes(e));
  if (add && out.length < MAX_VARIANTS && (!ADD_NEEDS_PAN.has(meal.form) || usesPan)) {
    for (const key of add.members) {
      const m = MEMBERS[key];
      if (inside.has(m.pierre)) continue;
      const token = ownedToken(m, have);
      if (!token || !ratedAs(m.pierre, add.technique, kb)) continue;
      if (KNIFE.has(m.prep) && !usesKnife(meal)) continue;
      out.push(addVariant(meal, m, token, key, add.technique));
      break;
    }
  }
  return out;
}

function swapVariant(meal, part, ing, from, to, token, key) {
  const parts = meal.parts.map((p) => (p === part ? { ...p, id: to.pierre } : p));
  // A template's own stand-in names ("Cheese toast" for plain bread) follow the swap too.
  const renamed = (i) => (i.swap ? { ...i, swap: Object.fromEntries(Object.entries(i.swap).map(([k, v]) => [k, v.name ? { ...v, name: swapText(v.name, from, to) } : v])) } : i);
  const ingredients = meal.ingredients.map((i) => (i === ing ? { id: token, amount: ing.amount, prep: to.prep } : renamed(i)));
  const d = {};
  for (const k of ['protein', 'kcal', 'fiber']) d[k] = Math.max(0, (meal.macros?.[k] ?? 0) + (to.macros[k] ?? 0) - (from.macros[k] ?? 0));
  return {
    ...meal,
    id: `${meal.id}~${key}`,
    // A name that doesn't say the food ("Boiled egg chaat") says the new one after it.
    name: swapText(meal.name, from, to) === meal.name ? `${meal.name} with ${to.word}` : swapText(meal.name, from, to),
    parts, ingredients,
    steps: meal.steps.map((s) => ({ ...s, text: swapText(s.text, from, to) })),
    macros: d, source: 'estimate',
    template: { from: meal.id, swap: { [memberOf(part.id) ?? part.id]: key } },
  };
}

function addVariant(meal, m, token, key, technique) {
  const prepText = m.prep === 'measure' ? `Measure out the ${m.word}.` : m.prep === 'peel' ? `Peel the ${m.word}.` : `Wash and chop the ${m.word}.`;
  const prepMin = m.prep === 'measure' ? 0.5 : m.prep === 'peel_chop' ? 3 : 2;
  const steps = [{ text: prepText, active: prepMin }, ...meal.steps];
  if (technique) {
    // Into the pan with the first cooking step, for two more minutes of stirring.
    const at = Math.max(1, steps.findIndex((s, i) => i > 0 && /\b(pan|fry|cook|stir|heat|scramble|saut)/i.test(s.text)));
    steps.splice(at + 1, 0, { text: `Add the ${m.word} and stir for 2 minutes.`, active: 2 });
  } else {
    steps.splice(steps.length - 1, 0, { text: `Mix in the ${m.word}.`, active: 0.5 });
  }
  const macros = {};
  for (const k of ['protein', 'kcal', 'fiber']) macros[k] = (meal.macros?.[k] ?? 0) + (m.macros[k] ?? 0);
  return {
    ...meal,
    id: `${meal.id}+${key}`,
    name: `${meal.name}${/\bwith\b/i.test(meal.name) ? ' and' : ' with'} ${m.word}`,
    parts: [...meal.parts, { id: m.pierre, ...(technique ? { technique } : {}) }],
    ingredients: [...meal.ingredients.map((i) => (i.swap ? { ...i, swap: Object.fromEntries(Object.entries(i.swap).map(([k, v]) => [k, v.name ? { ...v, name: `${v.name} with ${m.word}` } : v])) } : i)), { id: token, amount: m.prep === 'measure' ? 'a handful' : 'half, chopped', prep: m.prep }],
    steps, macros, source: 'estimate',
    template: { from: meal.id, add: key },
  };
}

/**
 * The catalogue as this kitchen opens it: every template, then its variants. A template the
 * kitchen can't make still opens (its paneer may be the only thing missing, and mushroom fills it).
 */
export function expandTemplates(catalogue, inventory, kb = PIERRE_RAW) {
  const have = inventory?.have ?? new Set();
  const out = [];
  const seen = new Set();
  for (const meal of catalogue) {
    out.push(meal);
    seen.add(meal.id);
    for (const v of variantsOf(meal, have, kb)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
  }
  return out;
}
