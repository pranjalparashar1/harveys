// The ingredient knowledge base: Pierre's raw layer, plus how central each food
// is to a meal. Everything here is pure (no DOM, no network) so it can be
// ported to MarcoCore.
//
// Three layers, bottom to top:
//   1. raw     what a food is on its own        (Pierre-trainer, src/brain/pierre-raw.js)
//   2. tech    what a technique does to it      (Pierre-tutor rows, then the class prior)
//   3. dish    a plate built from parts in a form (dishProfile, pierreTier)
// A dish is scored from its parts, so Pierre can judge any dish, including
// wacky AI ones, as long as it knows the parts.
import { PIERRE_RAW } from './pierre-raw.js';
import { TECHNIQUE_PRIOR } from './technique-prior.js';
import { DEFAULT_CONFIG } from './config.js';
import { foodClassOf, phaseOf, tempOf, umamiOf, TECHNIQUE_ALIASES, COATING_FATS, BLOOM_AROMATICS, inFat, isGrainBase, TOOMAMI } from './ontology.js';

// Flaky was merged into crisp (Step 4b, pranjal 20 Nov): crisp now reads "crisp, crunchy or
// flaky". Old ratings keep their flaky number; textureOf() folds it in as max(crisp, flaky).
export const TEXTURES = ['crisp', 'creamy', 'chewy', 'juicy'];
/** A stored texture row (maybe with the old flaky) as the four textures Pierre reads. */
export function textureOf(t = {}) {
  return Object.fromEntries(TEXTURES.map((k) => [k, clamp(k === 'crisp' ? Math.max(t.crisp ?? 0, t.flaky ?? 0) : (t[k] ?? 0), 0, 3)]));
}
// Taste is 0–3 per element, like texture. `canvas` is the sixth dimension: how much
// the food's flavour comes from the technique or what's added (tofu, rice: high).
export const TASTES = ['salt', 'sugar', 'fat', 'acid', 'heat', 'canvas', 'fresh'];
export const CENTRE_LABELS = { 1: 'accent', 2: 'support', 3: 'partner', 4: 'centre', 5: 'meal' };

/** A food's raw entry in vector form, or null if it hasn't been rated. */
export function rawVector(id, kb = PIERRE_RAW) {
  const f = kb.foods?.[id];
  if (!f) return null;
  return {
    id,
    texture: textureOf(f.texture),
    taste: Object.fromEntries(TASTES.map((k) => [k, clamp(f.taste?.[k] ?? 0, 0, 3)])),
    centre: clamp(f.centre ?? 2, 1, 5),
  };
}

// ── Centrality → Marco ──────────────────────────────────────────────────────
// The 1–5 centre score does four jobs:
//   role     3 and up is a MAJOR ingredient (cooked or prepped, carries friction);
//            1–2 is MINOR (just added). This replaces a hand-kept list.
//   anchor   the highest-centre food names the dish ("paneer bhurji").
//   margin   a major within 1 of the anchor is a CO-LEAD (paneer 4 + eggs 3 is
//            a two-lead plate); 2 or more below, it plays SUPPORT.
//   weight   a food's pull on the dish's texture doubles per step: 1, 2, 4, 8, 16.
//            Taste isn't weighted: a little cheese still salts the dish.
export const MAJOR_FROM = 3;
export const CO_LEAD_MARGIN = 1;
export const MAX_LEADS = 2;
// A 5 is a BASE (rice, pasta, oats). A plate holds one base: two 5s clash
// (rice + pasta), but a base takes 4s (rice + dal). pranjal's rule, 19 Nov.
export const BASE = 5;

export const roleOf = (centre) => (centre >= MAJOR_FROM ? 'major' : 'minor');
export const pullOf = (centre) => 2 ** (clamp(centre, 1, 5) - 1);

/**
 * How a plate is shaped: which food anchors it, which share the lead, which
 * support, which are accents. `meal` is false when nothing can anchor (a snack
 * or a side). `crowded` when more foods compete for the lead than a plate holds.
 */
export function plateShape(ids, kb = PIERRE_RAW) {
  const known = ids.map((id) => rawVector(id, kb)).filter(Boolean).sort((a, b) => b.centre - a.centre);
  const unknown = ids.filter((id) => !rawVector(id, kb));
  if (!known.length) return { anchor: null, leads: [], supports: [], accents: [], unknown, meal: false, crowded: false, bases: [], clash: false, majors: 0 };
  const top = known[0].centre;
  const leads = known.filter((f) => f.centre >= MAJOR_FROM && top - f.centre <= CO_LEAD_MARGIN).map((f) => f.id);
  const supports = known.filter((f) => !leads.includes(f.id) && f.centre >= 2).map((f) => f.id);
  const accents = known.filter((f) => f.centre < 2).map((f) => f.id);
  return {
    anchor: known[0].id,
    leads,
    supports,
    accents,
    unknown,
    meal: top >= MAJOR_FROM,
    crowded: leads.length > MAX_LEADS,
    bases: known.filter((f) => f.centre >= BASE).map((f) => f.id),
    clash: known.filter((f) => f.centre >= BASE).length > 1,
    majors: known.filter((f) => roleOf(f.centre) === 'major').length,
  };
}

/**
 * Foods that could share the lead with `anchorId`, from what's in the kitchen:
 * majors within the margin. Marco's search starts from anchors (centre 4–5)
 * and pairs them this way, instead of from a fixed list of recipes.
 */
export function partnersFor(anchorId, inventoryIds, kb = PIERRE_RAW) {
  const a = rawVector(anchorId, kb);
  if (!a) return [];
  return inventoryIds
    .filter((id) => id !== anchorId)
    .map((id) => rawVector(id, kb))
    .filter((f) => f && f.centre >= MAJOR_FROM && Math.abs(a.centre - f.centre) <= CO_LEAD_MARGIN)
    .filter((f) => !(a.centre >= BASE && f.centre >= BASE))
    .sort((x, y) => y.centre - x.centre)
    .map((f) => f.id);
}

// ── Techniques ──────────────────────────────────────────────────────────────
// A food cooked one way resolves, in order (v2 Step 3):
//   1. its rated row ("paneer@pan_fried", from Pierre-tutor, in the brain file's `tech`)
//   2. the class prior: the mean effect of that technique on rated foods of the same
//      class (dense_starchy, watery_veg), derived by scripts/derive-prior.mjs, PROVISIONAL
//   3. the raw vector
// A dish verdict from pranjal beats all three, in pierreTier().
export const TECHNIQUES = TECHNIQUE_PRIOR;
// Pierre-tutor's distance, 0–3: how many steps a food cooked one way (unsalted) is
// from done, where done leaves only context or assembly. A veto has no distance.
// It's Marco's finishing friction: what's still left to do. pranjal, 20 Nov.
export const DISTANCE = {
  0: 'done',               // melted cheese slice, fried onion garnish
  1: 'one finishing step', // salt, butter or a spread
  2: 'goes into something', // a sauce, tadka or masala
  3: 'another cooking step', // roasted suji, then upma
};
const READY_TO_DISTANCE = { 4: 0, 3: 1, 2: 2, 1: 3 }; // v1 readiness; 0 was the veto

export const techKey = (id, technique) => (technique ? `${id}@${technique}` : id);
/** A food's centre: its raw rating, else the one given to a prep-only food (eggs 4, whey 3). */
export const centreOf = (id, kb = PIERRE_RAW) => kb.foods?.[id]?.centre ?? kb.prep?.[id]?.centre ?? null;

/**
 * The vector for one part of a dish: a food, optionally cooked a certain way.
 * `state` is 'raw' (cold, as it is) or '@technique' (cooked, hot). `source` says
 * which layer answered: rated, prior or raw.
 */
export function partVector(part, kb = PIERRE_RAW, techniques = TECHNIQUES) {
  const { id, technique } = typeof part === 'string' ? { id: part } : part;
  const v = vectorOf(id, technique, kb, techniques);
  if (!v) return null;
  // Step 5 physics (ontology.js): what the food is, the physical state it's in, hot or cold, and
  // its savoury depth (an estimate). Rated numbers above are untouched.
  return { ...v, foodClass: foodClassOf(id), phase: phaseOf(id, technique, { cookFirst: cookFirst(id, kb) }), temp: tempOf(technique), umami: umamiOf(id, technique) };
}

function vectorOf(id, technique, kb, techniques) {
  const state = technique ? `@${technique}` : 'raw';
  // A tadka reads the sauté's rated row (garlic@bloom_tadka is garlic@sauteed), keeping its own name.
  const t = technique ? kb.tech?.[techKey(id, technique)] ?? kb.tech?.[techKey(id, TECHNIQUE_ALIASES[technique])] : null;
  if (t) {
    return {
      id,
      technique,
      state,
      texture: textureOf(t.texture),
      taste: Object.fromEntries(TASTES.map((k) => [k, clamp(t.taste?.[k] ?? 0, 0, 3)])),
      centre: centreOf(id, kb), // null for a prep-only food with no centre yet (besan, poha)
      distance: t.distance ?? null,
      veto: !!t.veto,
      source: 'rated',
    };
  }
  const raw = rawVector(id, kb);
  if (!raw) return null;
  const cls = kb.foods[id].class;
  const effect = technique ? (techniques[technique]?.[cls] ?? techniques[TECHNIQUE_ALIASES[technique]]?.[cls] ?? null) : null;
  if (!effect) return { ...raw, technique: technique ?? null, state, distance: null, veto: false, source: 'raw' };
  return {
    ...raw,
    technique,
    state,
    texture: Object.fromEntries(TEXTURES.map((k) => [k, clamp(raw.texture[k] + (effect.texture?.[k] ?? 0), 0, 3)])),
    taste: Object.fromEntries(TASTES.map((k) => [k, clamp(raw.taste[k] + (effect.taste?.[k] ?? 0), 0, 3)])),
    distance: effect.distance ?? null,
    veto: false,
    source: 'prior',
    provisional: true,
  };
}

// ── Modifiers (Step 3) ──────────────────────────────────────────────────────
// Salt and sugar are assumed present at dish level: you season to taste, so a dish
// never fails for lacking them. Salt and heat stay dish dimensions, fed by modifiers.
// PROVISIONAL: a modifier brings its dimension at Medium (2), the same reading the
// quiz gives a taste that was only marked present (tasteAssumed). Step 4 calibrates.
export const ASSUMED_TASTES = ['salt', 'sugar'];
export const PRESENT = 2;
// Calibrated from the benchmark (Step 4b): chaat masala was the only acid on two dishes you
// floored as bland (air-fried soya, the paneer cheese sandwich) and never carried a pass on
// its own, so it brings acid at Low. Pepper and chilli flakes stay at Medium: they carried
// boiled eggs, microwaved paneer and the cheese toast to your pass.
export const LOW = 1;
export const MODIFIERS = {
  salt: { salt: PRESENT },
  sugar: { sugar: PRESENT },
  honey: { sugar: PRESENT },
  oil: { fat: PRESENT },
  black_pepper: { heat: PRESENT },
  chilli_flakes: { heat: PRESENT },
  red_chilli_powder: { heat: PRESENT },
  green_chilli: { heat: PRESENT },
  chaat_masala: { salt: PRESENT, acid: LOW },
  // Round 3 pantry (pranjal, 21 Nov). ESTIMATES by Claude, not ratings: pranjal can rate them.
  // Olive oil is the round's cooking oil. Cocoa brings nothing Pierre measures (bitterness has
  // no dimension). Mint and the condiments (tomato sauce, chilli sauce, mayo) are foods in the
  // brain file with estimated taste and texture, so they count like any rated accent.
  olive_oil: { fat: PRESENT, estimate: true },
  oregano: { fresh: LOW, estimate: true },
  maggi_masala: { salt: PRESENT, heat: LOW, estimate: true },
  cocoa_powder: { estimate: true },
  // Open-ended pantry (1.29.0): what any seasoning brings, by its role (pantry.js). ESTIMATES.
  // Umami and crunch have no Pierre taste dimension, so they bring nothing measurable here.
  'role:salt': { salt: PRESENT, estimate: true },
  'role:acid': { acid: LOW, estimate: true },
  'role:heat': { heat: PRESENT, estimate: true },
  'role:sweet': { sugar: PRESENT, estimate: true },
  'role:fat': { fat: PRESENT, estimate: true },
  'role:fresh': { fresh: LOW, estimate: true },
};
// Cooking oils named as a modifier: the medium of a sauté, and a coating fat for a tadka.
export const OIL_MODIFIERS = ['oil', 'olive_oil'];

// ── Forms (Step 3) ──────────────────────────────────────────────────────────
// The grammar a dish declares. Each form names its slots and the states a slot takes:
// 'raw', 'cooked' (any @technique) or a specific '@technique'. A part's slot is its own
// `slot`, else from its centre: 5 base, the highest 3+ anchor (a base anchors when
// nothing else can), 1 modifier, the rest add-ons. `need` slots must be filled.
// An unknown form takes the `open` path: scored with no slot rules, labelled untested.
const ANY = ['raw', 'cooked'];
export const FORMS = {
  shake: { slots: { anchor: { need: true, states: ANY }, addOn: { states: ANY }, modifier: { states: ANY } } },
  bowl: { slots: { base: { states: ['cooked'] }, anchor: { need: true, states: ANY }, addOn: { states: ANY }, modifier: { states: ANY } } },
  // A toast's bread is toasted (or air- or pan-fried): you fixed peanut butter toast by toasting it.
  // Step 5: a toast's topping is an egg, paneer, cheese or a spread (Fable's toast_melt).
  toast: { slots: { base: { need: true, states: ['cooked'] }, anchor: { need: true, states: ANY }, addOn: { states: ANY }, modifier: { states: ANY } }, requires: ['topping'] },
  sandwich: { slots: { base: { need: true, states: ANY }, anchor: { need: true, states: ANY }, addOn: { states: ANY }, modifier: { states: ANY } } },
  mash: { slots: { anchor: { need: true, states: ['@mashed', 'cooked'] }, addOn: { states: ANY }, modifier: { states: ANY } } },
  bhurji: { slots: { anchor: { need: true, states: ['cooked'] }, addOn: { states: ANY }, modifier: { states: ANY } } },
  griddle: { slots: { base: { states: ['cooked'] }, anchor: { need: true, states: ['cooked'] }, addOn: { states: ANY }, modifier: { states: ANY } } },
  'one-pot': { slots: { base: { states: ['cooked'] }, anchor: { need: true, states: ['cooked'] }, addOn: { states: ANY }, modifier: { states: ANY } } },
};
// Fable's form names (Step 5, SFAH §4.2) as aliases, plus coated_base: a grain base and a coating
// (a sauce, curd, or a fat with a bloomed aromatic). The coating rule holds in every form, since
// it is physics: a sautéed tomato never coats pasta, whatever the dish is called.
FORMS.coated_base = { slots: { base: { need: true, states: ['cooked'] }, anchor: { states: ANY }, addOn: { states: ANY }, modifier: { states: ANY } }, requires: ['coating'] };
FORMS.toast_melt = FORMS.toast;
FORMS.cold_bowl = FORMS.bowl;
FORMS.chaat_salad = FORMS.bowl;
FORMS.savory_mash = FORMS.mash;
FORMS.griddle_cake = FORMS.griddle;
FORMS.quick_stir_bhurji = FORMS.bhurji;
FORMS.one_pot = FORMS['one-pot'];
export const OPEN_FORM = { slots: { anchor: { need: true, states: ANY }, base: { states: ANY }, addOn: { states: ANY }, modifier: { states: ANY } }, untested: true };
const stateFits = (state, states) => states.includes(state) || (state !== 'raw' && states.includes('cooked'));

/** Puts each part in a slot of the form. Parts are { id, technique?, slot? }. */
export function slotParts(parts, kb = PIERRE_RAW) {
  const ps = parts.map((p) => (typeof p === 'string' ? { id: p } : p)).map((p) => ({ ...p, centre: centreOf(p.id, kb), state: p.technique ? `@${p.technique}` : 'raw' }));
  const slotted = ps.map((p) => ({ ...p, slot: p.slot ?? (p.centre >= BASE ? 'base' : p.centre === 1 ? 'modifier' : null) }));
  if (!slotted.some((p) => p.slot === 'anchor')) {
    const pick = slotted.filter((p) => !p.slot && p.centre >= MAJOR_FROM).sort((a, b) => b.centre - a.centre)[0];
    const base = slotted.find((p) => p.slot === 'base');
    if (pick) pick.slot = 'anchor';
    else if (base) base.anchors = true; // the base is the meal (rice, toast): it fills both slots
  }
  return slotted.map((p) => ({ ...p, slot: p.slot ?? 'addOn' }));
}

/**
 * One texture throughout: two or more parts of the bite bring a texture at Medium+, and it's
 * the same one (boiled eggs mashed into hung curd, banana with peanut butter: all creamy).
 * Returns that texture, or null.
 */
function mushOf(vs) {
  const textured = vs.map((v) => TEXTURES.filter((k) => v.texture[k] >= 2)).filter((ks) => ks.length);
  const all = new Set(textured.flat());
  return textured.length >= 2 && all.size === 1 ? [...all][0] : null;
}

/** Largest number of textures at Medium or above that come from different parts. */
function contrastOf(vs) {
  const edges = vs.map((v) => TEXTURES.filter((k) => v.texture[k] >= 2));
  const owner = {};
  const augment = (i, seen) => edges[i].some((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    if (owner[k] == null || augment(owner[k], seen)) { owner[k] = i; return true; }
    return false;
  });
  return vs.reduce((n, _, i) => n + (augment(i, new Set()) ? 1 : 0), 0);
}

/**
 * What a dish tastes and feels like, from its parts and modifiers (ids like 'salt').
 * Texture: the max over parts that are a real share of the bite (centre ≥ 2), so a
 * garnish can't claim one; `contrast` counts textures at Medium+ from different parts.
 * Flavours: the strongest any part or modifier brings; salt and sugar assumed present.
 * Canvas: centre-weighted (a dish anchored on paneer stays a canvas).
 */
export function dishProfile(parts, kb = PIERRE_RAW, techniques = TECHNIQUES, modifiers = []) {
  const vs = parts.map((p) => partVector(p, kb, techniques)).filter(Boolean);
  if (!vs.length) return null;
  const bite = vs.filter((v) => v.centre == null || v.centre >= 2);
  const texture = Object.fromEntries(TEXTURES.map((k) => [k, Math.max(0, ...bite.map((v) => v.texture[k]))]));
  const total = vs.reduce((s, v) => s + pullOf(v.centre ?? 1), 0);
  const mods = modifiers.map((id) => MODIFIERS[id]).filter(Boolean);
  const taste = Object.fromEntries(TASTES.map((k) => [k, k === 'canvas'
    ? vs.reduce((s, v) => s + pullOf(v.centre ?? 1) * v.taste[k], 0) / total
    : Math.max(ASSUMED_TASTES.includes(k) ? PRESENT : 0, ...vs.map((v) => v.taste[k]), ...mods.map((m) => m[k] ?? 0))]));
  return {
    texture,
    taste,
    textures: TEXTURES.filter((k) => texture[k] >= 2),
    contrast: contrastOf(bite),
    tastes: TASTES.filter((k) => k !== 'canvas' && taste[k] > 0),
    // What the parts and modifiers really bring, without the assumed salt and sugar.
    brought: Object.fromEntries(TASTES.filter((k) => k !== 'canvas').map((k) => [k, Math.max(0, ...vs.map((v) => v.taste[k]), ...mods.map((m) => m[k] ?? 0))])),
    mush: mushOf(bite),
    assumed: ASSUMED_TASTES,
    shape: plateShape(vs.map((v) => v.id), kb),
    missing: parts.map((p) => (typeof p === 'string' ? p : p.id)).filter((id) => !rawVector(id, kb) && !(kb.prep?.[id])),
    unscored: parts.map((p) => (typeof p === 'string' ? { id: p } : p)).filter((p) => !partVector(p, kb, techniques)).map((p) => techKey(p.id, p.technique)),
    provisional: vs.filter((v) => v.source === 'prior').map((v) => techKey(v.id, v.technique)),
    // Distance of the cooked parts: a veto rules the dish out (microwaved eggs); 3 needs
    // another cooking step (fine in a chain, not as the last technique); 0–2 are what
    // Marco still has to add. `finish` maps each part to what's left to do.
    inedible: vs.filter((v) => v.veto).map((v) => techKey(v.id, v.technique)),
    unfinished: vs.filter((v) => v.distance === 3).map((v) => techKey(v.id, v.technique)),
    finish: Object.fromEntries(vs.filter((v) => v.distance != null).map((v) => [techKey(v.id, v.technique), DISTANCE[v.distance]])),
    // Step 5 physics. phases: each part's physical state. temp: hot and cold parts, and whether
    // the dish has both (a hot base with a cold garnish, SFAH's temperature contrast).
    phases: Object.fromEntries(vs.map((v) => [techKey(v.id, v.technique), v.phase])),
    temps: { hot: vs.filter((v) => v.temp === 'hot').map((v) => v.id), cold: vs.filter((v) => v.temp === 'cold').map((v) => v.id) },
    tempContrast: vs.some((v) => v.temp === 'hot') && vs.some((v) => v.temp === 'cold'),
    // Umami is an ESTIMATE (ontology.js), reported and never judged on.
    umami: { level: Math.max(0, ...vs.map((v) => v.umami)), sources: vs.filter((v) => v.umami > 0).map((v) => techKey(v.id, v.technique)), estimate: true, toomami: vs.filter((v) => v.umami > 0).length >= TOOMAMI },
    fatRoles: fatRolesOf(parts, modifiers, kb),
  };
}

// ── Fat roles (Step 5, SFAH §2.2) ───────────────────────────────────────────
// A pure fat in a dish does one of three jobs. Oil named as a modifier is the cooking medium.
// A fat beside a part cooked in fat (sautéed, pan-fried, scrambled) is that part's medium. A raw fat tossed
// through a hot grain base is the binder (butter swirled into pasta). Otherwise it's seasoning
// (butter on toast, ghee on dal). Reported, so Pierre and White can say what the fat is doing.
export function fatRolesOf(parts, modifiers = [], kb = PIERRE_RAW) {
  const ps = parts.map((p) => (typeof p === 'string' ? { id: p } : p));
  // A part fried, sautéed or scrambled needs a fat to cook in: a named fat is that medium.
  const bloomed = ps.some((p) => inFat(p.technique) && !COATING_FATS.includes(p.id));
  const base = ps.some((p) => p.technique && isGrainBase(p.id, centreOf(p.id, kb) ?? 0));
  const roles = {};
  for (const o of OIL_MODIFIERS) if (modifiers.includes(o)) roles[o] = 'cooking_medium';
  for (const p of ps.filter((x) => COATING_FATS.includes(x.id))) {
    roles[p.id] = p.technique || bloomed ? 'cooking_medium' : base ? 'main_binder' : 'seasoning';
  }
  // Mayo is a condiment: a cold emulsion spooned on or mixed in, never a cooking fat.
  for (const id of ['mayo']) if (ps.some((p) => p.id === id) || modifiers.includes(id)) roles[id] = 'seasoning';
  return roles;
}

/**
 * What coats a grain base (Step 5, §4.2 coated_base): a cohesive sauce or paste beside it (curd,
 * cooked dal, a simmered tomato, a mash), or a flavoured fat: a named fat (oil, ghee, butter)
 * with an aromatic cooked in it (garlic, onion: a tadka). A sautéed tomato is pieces, never a
 * sauce, and a plain fat only greases the base. Returns what coats it, or null.
 */
export function coatingOf(parts, modifiers = [], kb = PIERRE_RAW, techniques = TECHNIQUES) {
  const ps = parts.map((p) => (typeof p === 'string' ? { id: p } : p));
  const vs = ps.map((p) => partVector(p, kb, techniques)).filter(Boolean);
  const sauce = vs.find((v) => !isGrainBase(v.id, v.centre ?? 0) && (v.phase === 'cohesive_sauce' || v.phase === 'paste_mash'));
  if (sauce) return { kind: 'sauce', by: [techKey(sauce.id, sauce.technique)] };
  const fat = ps.find((p) => COATING_FATS.includes(p.id))?.id ?? OIL_MODIFIERS.find((o) => modifiers.includes(o)) ?? null;
  const aromatic = ps.find((p) => BLOOM_AROMATICS.includes(p.id) && inFat(p.technique));
  if (fat && aromatic) return { kind: 'flavored_fat', by: [fat, techKey(aromatic.id, aromatic.technique)] };
  return null;
}

// ── Harmony (Step 4b) ───────────────────────────────────────────────────────
// Pierre used to take the best of every part, so adding a part could never hurt. Your fixes
// show it can: dropping garlic, onion, capsicum or hung curd lifted 5 dishes. Three rules,
// each from those answers, each a floor (a reason, not a score):
//   sharp    a raw part with heat at Medium+ (raw onion, raw garlic) needs a High acid
//            (lemon) in the dish to sit right: chana chaat, sprouts salad and kala chana have
//            lemon and pass; bread, paneer and raw onion doesn't (you dropped the onion).
//            Tomato's Medium acid isn't enough.
//   mush     one texture throughout (see mushOf)
//   idle     a supporting part that brings nothing at Medium+, no texture and no flavour
//            (air-fried capsicum in the tikka: you dropped it and the tikka passed)
export const SHARP_HEAT = 2;
export const TAMING_ACID = 3;

/** A food that is never eaten as it comes (raw oats, pasta, potato): you rated it cooked. */
export const cookFirst = (id, kb = PIERRE_RAW) => !!(kb.foods?.[id]?.cookFirst || kb.prep?.[id]?.cookFirst);

// Step 5 (SFAH temperature contrast): sharp raw veg isn't a clash on a cooked base, since a cold
// crunch against hot toast is a garnish (holdout sandwich). One texture floors only a soft
// texture, and never a cold sweet dairy-and-fruit bowl (rules.mushTextures, PROVISIONAL).
const DAIRY_BOWL = ['curd', 'milk', 'cream'];
function sweetDairyBowl(vs, modifiers) {
  return vs.every((r) => r.v.temp === 'cold') && vs.some((r) => DAIRY_BOWL.includes(r.x.id))
    && vs.some((r) => r.v.foodClass === 'watery_veg_fruit' && r.v.taste.sugar >= 2) ;
}

function harmonyOf(slotted, p, kb, techniques, modifiers, rules = DEFAULT_CONFIG.pierreRules) {
  const why = [];
  const vs = slotted.map((x) => ({ x, v: partVector(x, kb, techniques) })).filter((r) => r.v);
  const acid = Math.max(0, ...vs.map((r) => r.v.taste.acid), ...modifiers.map((id) => MODIFIERS[id]?.acid ?? 0));
  // Sharp raw veg only: a condiment (chilli sauce) is a sauce as it comes, not a raw onion.
  const sharp = vs.filter((r) => r.v.state === 'raw' && r.v.phase === 'raw_edible' && r.v.taste.heat >= SHARP_HEAT).map((r) => r.x.id);
  // A cooked base (toasted bread, rice) carries a raw crunch: the sandwich with raw onion passed.
  const cookedBase = vs.some((r) => r.v.state !== 'raw' && (r.v.centre ?? 0) >= BASE);
  if (sharp.length && acid < TAMING_ACID && !(rules.sharpTamedByCookedBase && cookedBase)) why.push(`clash: raw ${sharp.join(', ')} with nothing sour enough (lemon) to tame it`);
  // Strong flavour lifts one texture (pranjal, 21 Nov): mashed chickpeas, butter and curd is all
  // creamy, but its taste (fat, acid, fresh) carries it. Pierre-left low, Pierre-right high.
  // A drink is meant to be smooth: one texture is the point of a shake.
  const drink = vs.some((r) => r.v.phase === 'liquid_drink' && r.x.slot !== 'addOn');
  const lift = drink || Object.entries(rules.mushLift).every(([k, min]) => (p.brought?.[k] ?? 0) >= min);
  if (p.mush && rules.mushTextures.includes(p.mush) && !sweetDairyBowl(vs, modifiers) && !lift) why.push(`one texture throughout: all ${p.mush}`);
  const idle = vs.filter((r) => r.x.slot === 'addOn' && (r.v.centre ?? 0) >= 2
    && !TEXTURES.some((k) => r.v.texture[k] >= 2) && !TASTES.some((k) => k !== 'canvas' && r.v.taste[k] >= 2)).map((r) => techKey(r.x.id, r.x.technique));
  if (idle.length) why.push(`clash: ${idle.join(', ')} adds nothing at Medium or above`);
  return why;
}

// ── Physics (Step 5, Fable's SFAH ontology) ─────────────────────────────────
// Vetoes that are chemistry, not taste: milk boiled with acid curdles; a sweet part with a savoury
// aromatic clashes (SFAH stage 1; the sides are PROVISIONAL lists in config).
const ACID_PARTS = 2;
function physicsVetoes(slotted, modifiers, rules) {
  const why = [];
  const ids = [...slotted.map((x) => x.id), ...modifiers];
  const milkHot = slotted.find((x) => x.id === 'milk' && x.technique && METHODS_BOIL.includes(x.technique));
  const acid = slotted.filter((x) => x.id !== 'milk' && (PIERRE_RAW.foods?.[x.id]?.taste?.acid ?? 0) >= ACID_PARTS).map((x) => x.id);
  if (milkHot && acid.length) why.push(`curdles: milk boiled with ${acid.join(', ')}`);
  const sweet = ids.filter((id) => rules.sweetSide.includes(id));
  const savoury = ids.filter((id) => rules.savourySide.includes(id));
  if (sweet.length && savoury.length) why.push(`clash: sweet ${sweet.join(', ')} with savoury ${savoury.join(', ')}`);
  return why;
}
const METHODS_BOIL = ['boiled', 'simmered', 'reduced', 'pressure_cooked'];

/**
 * Structure floors (Step 5, phase-aware FORMS):
 *   coating  a savoury dish on a grain base (pasta, rice, noodles, oats, poha) needs a coating
 *            (coatingOf). Sautéed tomato is pieces: boiled pasta with it is not a sauced pasta.
 *   topping  a toast carries an egg, paneer, cheese or a spread (toast_melt); a sautéed
 *            vegetable on toast isn't a meal (garlic mushroom toast).
 *   powder   whey or besan stirred in as a powder isn't hydrated: shake it or make a batter.
 */
const TOPPING_CLASSES = ['dense_protein_dairy', 'delicate_protein'];
function structureOf(slotted, form, modifiers, kb, techniques, rules) {
  const why = [];
  const vs = slotted.map((x) => ({ x, v: partVector(x, kb, techniques) })).filter((r) => r.v);
  const ids = [...slotted.map((x) => x.id), ...modifiers];
  const sweet = ids.some((id) => rules.sweetSide.includes(id));
  const bases = vs.filter((r) => isGrainBase(r.x.id, r.v.centre ?? 0) && r.v.phase !== 'raw_inedible');
  if (bases.length && !sweet && !coatingOf(slotted, modifiers, kb, techniques)) {
    const fats = slotted.filter((x) => COATING_FATS.includes(x.id) && !x.technique).map((x) => x.id);
    why.push(`no sauce: ${bases.map((r) => techKey(r.x.id, r.x.technique)).join(', ')} has nothing to coat it${fats.length ? ` (${fats.join(', ')} only greases it)` : ''}`);
  }
  // Read from the food itself, so an unrated cooking (eggs@air_fried) still counts as an egg.
  const topping = (x) => TOPPING_CLASSES.includes(foodClassOf(x.id)) || ['paste_mash', 'cohesive_sauce'].includes(phaseOf(x.id, x.technique));
  if ((FORMS[form]?.requires ?? []).includes('topping') && !slotted.some((x) => x.slot !== 'base' && topping(x))) {
    why.push('not a meal: a toast needs an egg, paneer, cheese or a spread on it');
  }
  const powder = slotted.filter((x) => foodClassOf(x.id) === 'protein_powder_flour' && !x.technique).map((x) => x.id);
  if (powder.length) why.push(`texture: ${powder.join(', ')} stirred in as a powder (shake it into a drink or cook it into a batter)`);
  return why;
}

/** A plate with no anchor that still works as a snack: two supports with real texture contrast (apple + peanut butter). */
function snackPairing(slotted, p, rules) {
  return slotted.every((x) => x.centre != null) && slotted.filter((x) => x.centre >= 2).length >= 2 && (p?.contrast ?? 0) >= rules.snackContrast;
}

// ── Pierre's tier (Step 3) ──────────────────────────────────────────────────
export const TIERS = ['veto', 'floor', 'pass', 'crave'];
/** pranjal's verdict on a dish as a tier: `tier` if given, else fail → veto, meh → floor, pass → pass. */
export const verdictTier = (seed) => seed?.tier ?? { fail: 'veto', meh: 'floor', pass: 'pass' }[seed?.verdict] ?? null;

// The flavour floor (Step 4b): one of fat, acid, heat, fresh or a part's own sugar at Medium+,
// where fat and sugar don't clear it alone, only with each other or with acid, heat or fresh.
// You called 8 dishes bland that cleared the old floor on fat alone (paneer, cheese, butter).
// `done`: the anchor is a row you rated done as it is (distance 0, a whey shake), so its
// flavour is yours, not Pierre's to second-guess.
// `carried`: a cooked part of a floor.fatCarries class (a cooked egg) is in the dish, so fat
// clears the floor alone (pranjal, 26 Nov: a plain omelette is a pass).
function belowFloor(p, floor, done = false, carried = false) {
  const why = [];
  const strong = floor.flavours.filter((k) => (p.brought?.[k] ?? p.taste[k]) >= floor.flavourMin);
  const alone = (floor.notAlone ?? []).filter((k) => !(carried && k === 'fat'));
  const clears = strong.some((k) => !alone.includes(k)) || strong.length >= 2;
  if (!done && !clears) {
    why.push(strong.length ? `only ${strong.join(', ')} at Medium or above: needs acid, heat or fresh with it` : `no ${floor.flavours.join(', ')} at Medium or above`);
  }
  if (p.textures.length < floor.texturesMin) why.push('no texture at Medium or above');
  return why;
}

/**
 * Pierre's verdict on a dish: veto | floor | pass | crave.
 *   veto   a part is vetoed (microwaved eggs), or pranjal's verdict is fail
 *   floor  no anchor (100 g butter with salt), a part in a state the form doesn't take
 *          (raw oats as a bowl's base), a part that needs another cooking step, or below
 *          the PROVISIONAL taste/texture floor; `upgrade` names the cheapest modifier in
 *          the kitchen that lifts it (+ chaat masala, + butter)
 *   pass   clears the floor
 *   crave  only from pranjal (a crave verdict, later repeat "Cooked this"); never computed
 * opts: { modifiers: ids in the dish, inventory: ids in the kitchen, verdict: a PIERRE_SEED entry }.
 * `computed` is the tier before the verdict, so the two can be compared.
 */
export function pierreTier(parts, form, { modifiers = [], inventory = [], verdict = null, kb = PIERRE_RAW, techniques = TECHNIQUES, floor = DEFAULT_CONFIG.pierreFloor, rules = DEFAULT_CONFIG.pierreRules } = {}) {
  // pranjal's own tier for this exact dish, from a bench repair (pierre-raw.js `dishes`).
  const owned = verdict ? null : kb.dishes?.[chainKey(parts, modifiers)] ?? null;
  const asGiven = { parts, modifiers };
  // A rated food named among the modifiers and not among the parts (garlic) is a part of the
  // dish, as it comes. Unrated ones (turmeric) stay ignored, as before.
  const named = new Set(parts.map((x) => (typeof x === 'string' ? x : x.id)));
  parts = [...parts, ...modifiers.filter((id) => !MODIFIERS[id] && !named.has(id) && rawVector(id, kb)).map((id) => ({ id }))];
  modifiers = modifiers.filter((id) => MODIFIERS[id]);
  const grammar = FORMS[form] ?? OPEN_FORM;
  const p = dishProfile(parts, kb, techniques, modifiers);
  // A cook-first exception (rules.cookFirstExceptions: oats in a shake) is blended in raw, so it
  // thickens as an add-on rather than standing as the dish's base.
  const excepted = (id) => (rules?.cookFirstExceptions ?? []).some((e) => e.id === id && e.form === form);
  const slotted = slotParts(parts.map((x) => (typeof x !== 'string' && !x.technique && !x.slot && excepted(x.id) ? { ...x, slot: 'addOn' } : x)), kb);
  const why = [];
  // Inedible raw (Step 5 phase raw_inedible): pranjal's cook-first list, and raw eggs.
  const raw = slotted.filter((x) => x.state === 'raw' && ((cookFirst(x.id, kb) && !excepted(x.id)) || foodClassOf(x.id) === 'delicate_protein')).map((x) => x.id);
  const physics = physicsVetoes(slotted, modifiers, rules);
  // Raw garlic vetoes a dish where nothing is cooked (pranjal, 20 Nov: "for now").
  const sharp = slotted.some((x) => x.state !== 'raw') ? [] : slotted.filter((x) => kb.foods?.[x.id]?.vetoUncooked).map((x) => x.id);
  const carried = slotted.some((x) => x.state !== 'raw' && (floor.fatCarries ?? []).includes(foodClassOf(x.id)));
  let computed;
  let repairs = [];
  if (p?.inedible.length || raw.length || sharp.length || physics.length) {
    computed = 'veto';
    why.push(...physics);
    if (p?.inedible.length) why.push(`vetoed: ${p.inedible.join(', ')}`);
    if (raw.length) why.push(`raw: ${raw.join(', ')} ${raw.length > 1 ? 'need' : 'needs'} cooking first`);
    if (sharp.length) why.push(`raw ${sharp.join(', ')} in a dish where nothing is cooked`);
  } else {
    for (const [slot, rule] of Object.entries(grammar.slots)) {
      const inSlot = slotted.filter((x) => x.slot === slot);
      if (rule.need && !inSlot.length && !(slot === 'anchor' && (slotted.some((x) => x.anchors) || snackPairing(slotted, p, rules)))) {
        const unrated = slotted.filter((x) => x.centre == null).map((x) => x.id);
        why.push(slot === 'anchor' && unrated.length ? `no anchor (no centre rated for ${unrated.join(', ')})` : `no ${slot}`);
      }
      for (const x of inSlot) if (!stateFits(x.state, rule.states)) why.push(`${techKey(x.id, x.technique)} doesn't fit a ${form}'s ${slot}`);
    }
    for (const x of slotted) if (!grammar.slots[x.slot]) why.push(`a ${form} has no ${x.slot}`);
    if (p?.unfinished.length) why.push(`needs another cooking step: ${p.unfinished.join(', ')}`);
    if (p?.unscored.length) why.push(`can't judge ${p.unscored.join(', ')}: not rated that way`);
    if (p) why.push(...structureOf(slotted, form, modifiers, kb, techniques, rules));
    // Tap-to-repair: a dry-heated raw starch with no fat (PROVISIONAL prior), and every rule
    // pranjal taught by fixing a dish of the same class. Each names the slot to fix.
    repairs = repairHintsOf(asGiven.parts, asGiven.modifiers, kb, rules);
    why.push(...repairs.map((h) => h.reason));
    if (p) why.push(...harmonyOf(slotted, p, kb, techniques, modifiers, rules));
    const anchor = slotted.find((x) => x.slot === 'anchor') ?? slotted.find((x) => x.anchors);
    // Round 3: a base that is done as it is (Maggi cooked with its masala) carries its flavour
    // under a topping too, as it does alone.
    const done = (anchor ? partVector(anchor, kb, techniques)?.distance === 0 : false)
      || slotted.some((x) => x.slot === 'base' && partVector(x, kb, techniques)?.distance === 0);
    if (!p) why.push('no rated parts');
    else why.push(...belowFloor(p, floor, done, carried));
    computed = why.length ? 'floor' : 'pass';
  }
  let upgrade = null;
  // (Compare the reasons, not just their count: "can't judge makhana" is one reason too.)
  const shortfall = p ? belowFloor(p, floor, false, carried) : [];
  if (computed === 'floor' && p && why.length && why.every((w) => shortfall.includes(w))) {
    // Only a taste/texture shortfall can be lifted by adding something.
    const has = new Set([...modifiers, ...parts.map((x) => (typeof x === 'string' ? x : x.id))]);
    const lifts = (extraParts, extraMods) => {
      const q = dishProfile([...parts, ...extraParts], kb, techniques, [...modifiers, ...extraMods]);
      return q && !belowFloor(q, floor, false, carried).length;
    };
    // Cheapest first: a spice or condiment shaken in, then a rated minor food spooned on.
    // An upgrade keeps the dish's side: a sweet dish (a part at sugar 2+) takes only sweet
    // additions, a savoury one only the rest. Oil is a cooking medium, never an add-on.
    const sweet = (taste) => (taste?.sugar ?? 0) >= 2;
    const dishSweet = parts.some((x) => sweet(partVector(x, kb, techniques)?.taste));
    const sameSide = (taste) => sweet(taste) === dishSweet;
    const spices = inventory.filter((id) => MODIFIERS[id] && !OIL_MODIFIERS.includes(id) && !has.has(id) && sameSide(MODIFIERS[id]) && lifts([], [id]));
    const foods = inventory.filter((id) => !has.has(id) && !MODIFIERS[id] && (kb.foods?.[id]?.centre ?? 9) <= 2 && sameSide(kb.foods[id].taste) && lifts([id], [])).sort((a, b) => kb.foods[a].centre - kb.foods[b].centre);
    const all = [...spices, ...foods];
    if (all.length) upgrade = { add: all[0], options: all };
  }
  const mine = verdictTier(verdict) ?? owned?.tier ?? null;
  const tier = mine ?? computed;
  return { tier, computed, source: mine ? 'verdict' : 'computed', why, upgrade, repairs, untested: !!grammar.untested, profile: p };
}

// ── Ratings in, brain file out ──────────────────────────────────────────────
/**
 * Merges quiz ratings ({ id: { texture, taste, centre, prep, at } }) into a brain file. Newer wins.
 * A food is rated (it has a centre), part of prep (`prep: true`, "needs further processing",
 * like soaked poha), or both (paneer). Prep foods are listed in `prep`, where Pierre-tutor
 * starts; a food that is only prep has no raw ratings.
 */
// centres: { whey: 4 } gives a prep-only food its centre 1–5 (Step 2), kept on its prep entry.
// merges: { dal: ['moong_dal', …] } folds foods pranjal calls one food into one id (20 Nov:
// "all dals are one food"). Each dimension takes the members' most common rating; the old ids
// stay as aliases, so a later rating of moong_dal lands on dal.
export function mergeRatings(kb, ratings, { exclude = [], centres = {}, merges = {}, classes = {}, cookFirst: cooks = [], vetoUncooked = [] } = {}) {
  const aliases = { ...(kb.aliases ?? {}) };
  for (const [to, from] of Object.entries(merges)) for (const id of from) if (id !== to) aliases[id] = to;
  ratings = Object.fromEntries(Object.entries(ratings).map(([id, r]) => [aliases[id] ?? id, r]));
  const foods = { ...(kb.foods ?? {}) };
  const prep = { ...(kb.prep ?? {}) };
  const tech = { ...(kb.tech ?? {}) };
  // Foods set aside for now (too much work, or unfamiliar): kept out of training
  // until pranjal brings them back. A later rating doesn't re-add them.
  const excluded = [...new Set([...(kb.excluded ?? []), ...exclude])].sort();
  for (const id of excluded) { delete foods[id]; delete prep[id]; delete tech[id]; }
  for (const [id, r] of Object.entries(ratings)) {
    if (!/^[a-z][a-z0-9_@]*$/.test(id) || excluded.includes(id)) continue;
    if (r.remove) { excluded.push(id); delete foods[id]; delete prep[id]; delete tech[id]; continue; }
    const old = foods[id] ?? prep[id] ?? tech[id];
    if (old?.at && r.at && old.at > r.at) continue;
    // Pierre-tutor: a food cooked one way, and its distance from done (0–3, or a veto).
    // Its centre is the food's own. v1 answers carried readiness 0–4 instead.
    if (id.includes('@')) {
      const d = r.distance ?? (r.ready == null ? null : r.ready === 0 ? 'x' : READY_TO_DISTANCE[clamp(Math.round(r.ready), 1, 4)]);
      if (d == null) continue;
      tech[id] = {
        texture: textureOf(Object.fromEntries(Object.entries(r.texture ?? {}).map(([k, v]) => [k, Math.round(v)]))),
        taste: Object.fromEntries(TASTES.map((k) => [k, clamp(Math.round(r.taste?.[k] ?? 0), 0, 3)])),
        ...(d === 'x' ? { veto: true } : { distance: clamp(Math.round(d), 0, 3) }),
        ...(r.at ? { at: r.at } : {}),
      };
      continue;
    }
    if (r.prep) prep[id] = { ...(prep[id]?.centre ? { centre: prep[id].centre } : {}), ...(r.at ? { at: r.at } : {}) };
    else delete prep[id];
    if (r.centre == null) {
      delete foods[id];
      continue;
    }
    foods[id] = {
      texture: textureOf(Object.fromEntries(Object.entries(r.texture ?? {}).map(([k, v]) => [k, Math.round(v)]))),
      // A rating without salt or heat (the quiz stopped asking them, Step 3) keeps the old value.
      taste: Object.fromEntries(TASTES.map((k) => [k, clamp(Math.round(r.taste?.[k] ?? foods[id]?.taste?.[k] ?? 0), 0, 3)])),
      ...(foods[id]?.class ? { class: foods[id].class } : {}),
      ...(r.tasteAssumed ? { tasteAssumed: true } : {}),
      centre: clamp(Math.round(r.centre ?? 2), 1, 5),
      role: roleOf(r.centre ?? 2),
      ...(r.at ? { at: r.at } : {}),
    };
  }
  for (const [to, from] of Object.entries(merges)) {
    const rated = from.map((id) => foods[id]).filter(Boolean);
    if (rated.length) {
      const mode = (vals) => { const n = {}; for (const v of vals) n[v] = (n[v] ?? 0) + 1; return Number(Object.keys(n).sort((a, b) => n[b] - n[a] || a - b)[0]); };
      const centre = mode(rated.map((f) => f.centre));
      foods[to] = {
        texture: Object.fromEntries(TEXTURES.map((k) => [k, mode(rated.map((f) => textureOf(f.texture)[k]))])),
        taste: Object.fromEntries(TASTES.map((k) => [k, mode(rated.map((f) => f.taste[k]))])),
        centre,
        role: roleOf(centre),
        at: rated.map((f) => f.at).filter(Boolean).sort().at(-1),
        mergedFrom: from,
      };
    }
    const preps = from.map((id) => prep[id]).filter(Boolean);
    if (preps.length) prep[to] = { at: preps.map((x) => x.at).filter(Boolean).sort().at(-1) };
    for (const id of from) if (id !== to) { delete foods[id]; delete prep[id]; }
  }
  // classes: { dense_starchy: ['paneer', …] } (Step 3): which food class a food's cooked
  // forms follow when it has no rated row. A label, not a rating; the prior is derived from it.
  for (const [cls, ids] of Object.entries(classes)) for (const id of ids) {
    if (!foods[id]) throw new Error(`${id} has no raw rating, so it can't take a class`);
    foods[id] = { ...foods[id], class: cls };
  }
  // cookFirst: ['oats', …] (Step 4b): foods you never eat as they come. A dish with one raw is a veto.
  for (const id of cooks) {
    if (foods[id]) foods[id] = { ...foods[id], cookFirst: true };
    else if (prep[id]) prep[id] = { ...prep[id], cookFirst: true };
    else throw new Error(`${id} isn't in the brain, so it can't be marked cook-first`);
  }
  // vetoUncooked: ['garlic'] (Step 4b): raw, it vetoes a dish where nothing is cooked.
  for (const id of vetoUncooked) {
    if (!foods[id]) throw new Error(`${id} has no raw rating, so it can't veto uncooked dishes`);
    foods[id] = { ...foods[id], vetoUncooked: true };
  }
  for (const [id, c] of Object.entries(centres)) {
    if (!prep[id]) throw new Error(`${id} is not a prep-only food; rate its centre in the quiz`);
    prep[id] = { ...prep[id], centre: clamp(Math.round(c), 1, 5) };
  }
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return { ...kb, foods: sorted(foods), prep: sorted(prep), ...(Object.keys(aliases).length ? { aliases: sorted(aliases) } : {}), ...(Object.keys(tech).length ? { tech: sorted(tech) } : {}), excluded: [...new Set(excluded)].sort() };
}

function clamp(x, lo, hi) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

// ── The dish chain (tap-to-repair, 21 Nov) ──────────────────────────────────
// Every dish read as a pseudo-flowchart of food nodes and connectors, so pranjal can tap one
// slot on a bench card, swap it, and teach Pierre the exact change that lifted it:
//   [potato] → seasoned with [salt, chilli flakes] → cooked with [none] → technique [air fried]
//            → topped with [nothing] → served with [mayo]
// Plain JSON both ways (Codable in MarcoCore). Parts that fit no slot (onion and tomato in a
// bhurji, a toast's bread) ride along in `with`, so nothing is lost on the way back.
export const CHAIN_SLOTS = ['anchor', 'seasonedWith', 'cookedWith', 'technique', 'toppedWith', 'servedWith'];
// Fats that can be the medium a food cooks in (cream and mayo never are).
export const MEDIUM_FATS = ['oil', 'olive_oil', 'ghee', 'butter'];
// Sides and dips on the round-3 pantry (hung curd is out, pranjal 21 Nov).
export const SERVED_WITH = ['mayo', 'tomato_sauce', 'chilli_sauce', 'curd'];
export const TOPPED_WITH = ['coriander', 'onion', 'spring_onion', 'cheese_slices', 'mozzarella', 'lemon', 'peanuts', 'mint'];
// Condiments that sheets list as modifiers, not parts (mayo on the side, a squirt of ketchup).
const CONDIMENT_MODS = ['mayo', 'tomato_sauce', 'chilli_sauce'];
const asMod = (id) => OIL_MODIFIERS.includes(id) || CONDIMENT_MODS.includes(id);
const toPart = (p) => {
  if (typeof p !== 'string') return p.technique ? { id: p.id, technique: p.technique } : { id: p.id };
  const [id, technique] = p.split('@');
  return technique ? { id, technique } : { id };
};

/** The items of any dish shape: a sheet dish ({ items }) or a generator/catalogue row ({ parts, modifiers }). */
function itemsOf(dish) {
  if (dish.items) return dish.items.map((it) => (it.mod ? { id: it.id, mod: true } : toPart(it)));
  return [...(dish.parts ?? []).map(toPart), ...(dish.modifiers ?? []).map((id) => ({ id, mod: true }))];
}

/** A dish as its 6-slot chain. `dish` is a sheet dish, a generator row or a catalogue meal. */
export function toDishChain(dish, kb = PIERRE_RAW) {
  const items = itemsOf(dish);
  const parts = items.filter((x) => !x.mod);
  let mods = items.filter((x) => x.mod).map((x) => x.id);
  const roles = fatRolesOf(parts, mods, kb);
  // The anchor is the part pierreTier anchors on: the anchor slot, else a base that is the meal.
  const slotted = slotParts(parts, kb);
  const found = slotted.findIndex((x) => x.slot === 'anchor');
  const ai = found >= 0 ? found : Math.max(0, slotted.findIndex((x) => x.anchors));
  let rest = parts.filter((_, i) => i !== ai);
  const anchor = parts[ai] ?? null;
  // A part first; a modifier only when it is a condiment a sheet lists as one (mayo on the side).
  const take = (pred, fromMods = false) => {
    const p = rest.findIndex((x) => pred(x));
    if (p >= 0) { const x = rest[p]; rest = rest.filter((_, i) => i !== p); return x; }
    const m = fromMods ? mods.findIndex((id) => CONDIMENT_MODS.includes(id) && pred({ id })) : -1;
    if (m >= 0) { const id = mods[m]; mods = mods.filter((_, i) => i !== m); return { id }; }
    return null;
  };
  // Cooked with: an oil named as a modifier, else a fat beside a part cooked in it.
  const oil = mods.find((id) => OIL_MODIFIERS.includes(id));
  let cookedWith = null;
  if (oil) { cookedWith = oil; mods = mods.filter((id) => id !== oil); } else {
    const fat = rest.find((x) => MEDIUM_FATS.includes(x.id) && !x.technique && roles[x.id] === 'cooking_medium');
    if (fat) { cookedWith = fat.id; rest = rest.filter((x) => x !== fat); }
  }
  const served = take((x) => SERVED_WITH.includes(x.id) && !x.technique, true);
  const topped = take((x) => TOPPED_WITH.includes(x.id) && !x.technique);
  return {
    ...(dish.id ? { id: dish.id } : {}),
    form: dish.form ?? null,
    anchor: anchor ? { id: anchor.id } : null,
    seasonedWith: mods,
    cookedWith,
    technique: anchor?.technique ?? null,
    toppedWith: topped ? { id: topped.id } : null,
    servedWith: served ? { id: served.id, role: served.id === 'curd' ? 'side' : 'dip' } : null,
    with: rest,
  };
}

/** A chain back to a dish: { form, parts, modifiers }, the shape pierreTier takes. */
export function fromDishChain(chain) {
  const parts = [];
  const modifiers = [...(chain.seasonedWith ?? [])];
  if (chain.anchor) parts.push(chain.technique ? { id: chain.anchor.id, technique: chain.technique } : { id: chain.anchor.id });
  parts.push(...(chain.with ?? []).map(toPart));
  for (const id of [chain.cookedWith, chain.toppedWith?.id, chain.servedWith?.id]) {
    if (!id) continue;
    if (asMod(id)) modifiers.push(id); else parts.push({ id });
  }
  return { ...(chain.id ? { id: chain.id } : {}), form: chain.form ?? null, parts, modifiers };
}

/** A dish's identity for owner verdicts, whatever order its parts come in. */
export function chainKey(parts, modifiers = []) {
  return [...parts.map((p) => (typeof p === 'string' ? p : techKey(p.id, p.technique))), ...modifiers].sort().join('+');
}

// A slot's value as a plain comparable: an id, null, or a sorted list.
export function slotValue(chain, slot) {
  const v = chain?.[slot];
  if (slot === 'seasonedWith') return [...(v ?? [])].sort();
  if (v && typeof v === 'object') return v.id ?? null;
  return v ?? null;
}
export const sameSlotValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A chain with edits ({ slot, to }) applied. */
export function applyChainEdits(chain, edits = []) {
  const out = { ...chain, seasonedWith: [...(chain.seasonedWith ?? [])], with: [...(chain.with ?? [])] };
  for (const e of edits) {
    const to = e.to ?? null;
    if (e.slot === 'seasonedWith') out.seasonedWith = [...(to ?? [])];
    else if (e.slot === 'anchor') out.anchor = to ? { id: to } : null;
    else if (e.slot === 'toppedWith') out.toppedWith = to ? { id: to } : null;
    else if (e.slot === 'servedWith') out.servedWith = to ? { id: to, role: chain.servedWith?.role ?? (to === 'curd' ? 'side' : 'dip') } : null;
    else if (e.slot === 'cookedWith' || e.slot === 'technique') out[e.slot] = to;
  }
  return out;
}

// ── Learned repair rules (from pranjal's repairs only, via scripts/ingest-pierre.mjs) ──
/** The class rules pranjal taught for a food class cooked one way ('raw' when as it comes). */
export function learnedRulesFor(foodClass, technique, kb = PIERRE_RAW) {
  const t = technique ?? 'raw';
  return Object.values(kb.rules ?? {}).filter((r) => r.foodClass === foodClass && r.technique === t);
}

/** Does a chain break a rule? Returns the repair hint, or null. */
function ruleHint(chain, r) {
  const v = slotValue(chain, r.slot);
  const label = (id) => String(id).replace(/_/g, ' ');
  let broken = false;
  if (r.slot === 'seasonedWith') {
    broken = (r.requireAny?.length && !r.requireAny.some((id) => v.includes(id))) || (r.avoid?.length && r.avoid.some((id) => v.includes(id)));
  } else {
    broken = (r.requireNonNull && v == null) || (r.avoid != null && v === r.avoid);
  }
  if (!broken) return null;
  return { slot: r.slot, suggest: r.preferred ?? null, reason: `you fixed ${r.learnedFrom.join(', ')} this way: ${label(r.foodClass)} ${label(r.technique)} wants ${r.slot.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)} ${label(r.preferred ?? 'something')}`, source: 'learned', rule: r.id };
}

/** A chain with every learned rule for its anchor applied: what a generator should pitch. */
export function applyLearnedRules(chain, kb = PIERRE_RAW) {
  if (!chain.anchor) return chain;
  let out = chain;
  for (const r of learnedRulesFor(foodClassOf(chain.anchor.id), chain.technique, kb)) {
    if (!ruleHint(out, r)) continue;
    const to = r.slot === 'seasonedWith' ? [...slotValue(out, r.slot).filter((id) => !(r.avoid ?? []).includes(id)), ...(r.preferred ? [r.preferred] : [])] : r.preferred ?? null;
    out = applyChainEdits(out, [{ slot: r.slot, to }]);
  }
  return out;
}

/** Generator rows ({ parts, modifiers, form, … }) with learned rules applied; `learned` lists what changed. */
export function withLearnedRules(rows, kb = PIERRE_RAW) {
  return rows.map((row) => {
    const chain = toDishChain(row, kb);
    const fixed = applyLearnedRules(chain, kb);
    if (fixed === chain) return row;
    const back = fromDishChain(fixed);
    return { ...row, parts: back.parts, modifiers: back.modifiers, learned: learnedRulesFor(foodClassOf(chain.anchor.id), chain.technique, kb).map((r) => r.id) };
  });
}

/**
 * Cooking-medium and learned-rule repairs a dish needs (used by pierreTier). Each is a floor
 * with a hint at the slot to fix: { slot, suggest, reason, source: 'provisional' | 'learned' }.
 */
export function repairHintsOf(parts, modifiers = [], kb = PIERRE_RAW, rules = DEFAULT_CONFIG.pierreRules) {
  const hints = [];
  const chain = toDishChain({ parts, modifiers }, kb);
  const learned = chain.anchor ? learnedRulesFor(foodClassOf(chain.anchor.id), chain.technique, kb) : [];
  for (const r of learned) { const h = ruleHint(chain, r); if (h) hints.push(h); }
  const dry = rules.dryHeatNeedsFat;
  const hasFat = modifiers.some((id) => MEDIUM_FATS.includes(id)) || parts.some((p) => MEDIUM_FATS.includes(typeof p === 'string' ? p : p.id));
  if (dry?.on && !hasFat && !hints.some((h) => h.slot === 'cookedWith')) {
    const dried = parts.map(toPart).filter((p) => dry.techniques.includes(p.technique) && dry.classes.includes(foodClassOf(p.id)) && (!dry.cookFirstOnly || cookFirst(p.id, kb)));
    for (const p of dried) hints.push({ slot: 'cookedWith', suggest: 'oil', reason: `dry: ${techKey(p.id, p.technique)} has no cooking fat, so it dries out instead of crisping`, source: 'provisional' });
  }
  return hints;
}

/**
 * Pulls bench repair pairs into the brain file. Each repair is
 *   { dishId, dish (a sheet dish), before, edits: [{ slot, from, to }], after, scope, at }.
 *   repairs  every repair, by dish id (newer wins): the provenance trail
 *   dishes   pranjal's tier for the dish as suggested and as fixed, by chainKey, so pierreTier
 *            reproduces both (crave only ever comes from here)
 *   rules    scope 'class', the fix lifted veto/floor to pass/crave: one rule per
 *            foodClass × technique × slot, which every food of the class inherits
 * Pure and deterministic: ingesting the same repairs twice gives the same brain.
 */
export function mergeRepairs(kb, repairs) {
  const LOW = ['veto', 'floor'];
  const HIGH = ['pass', 'crave'];
  const out = { repairs: { ...(kb.repairs ?? {}) }, dishes: { ...(kb.dishes ?? {}) }, rules: { ...(kb.rules ?? {}) } };
  const ordered = [...repairs].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || a.dishId.localeCompare(b.dishId));
  for (const r of ordered) {
    const old = out.repairs[r.dishId];
    if (old?.at && r.at && old.at > r.at) continue;
    out.repairs[r.dishId] = { before: r.before, edits: r.edits, after: r.after, scope: r.scope, ...(r.at ? { at: r.at } : {}) };
    const chain = toDishChain(r.dish, kb);
    const fixed = fromDishChain(applyChainEdits(chain, r.edits));
    const orig = fromDishChain(chain);
    if (r.before) out.dishes[chainKey(orig.parts, orig.modifiers)] = { tier: r.before, from: r.dishId, ...(r.at ? { at: r.at } : {}) };
    if (r.after) out.dishes[chainKey(fixed.parts, fixed.modifiers)] = { tier: r.after, from: r.dishId, fixed: true, ...(r.at ? { at: r.at } : {}) };
    if (r.scope !== 'class' || !LOW.includes(r.before) || !HIGH.includes(r.after) || !chain.anchor) continue;
    const foodClass = foodClassOf(chain.anchor.id);
    if (!foodClass) continue;
    for (const e of r.edits) {
      if (e.slot === 'anchor') continue;
      const technique = (e.slot === 'technique' ? e.from : chain.technique) ?? 'raw';
      const rule = { foodClass, technique, slot: e.slot };
      if (e.slot === 'seasonedWith') {
        const added = (e.to ?? []).filter((id) => !(e.from ?? []).includes(id));
        const dropped = (e.from ?? []).filter((id) => !(e.to ?? []).includes(id));
        if (!added.length && !dropped.length) continue;
        Object.assign(rule, added.length ? { requireAny: added } : {}, dropped.length ? { avoid: dropped } : {}, { preferred: added[0] ?? null });
      } else if (e.from == null) {
        if (e.to == null) continue;
        Object.assign(rule, { requireNonNull: true, preferred: e.to });
      } else {
        Object.assign(rule, { avoid: e.from, preferred: e.to ?? null });
      }
      const id = `${foodClass}@${technique}:${e.slot}`;
      const prev = out.rules[id];
      out.rules[id] = { id, ...rule, learnedFrom: [...new Set([...(prev?.learnedFrom ?? []), r.dishId])].sort(), ...(r.at ? { at: r.at } : {}) };
    }
  }
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return { ...kb, repairs: sorted(out.repairs), dishes: sorted(out.dishes), rules: sorted(out.rules) };
}
