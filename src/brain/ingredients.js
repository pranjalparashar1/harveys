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
  const state = technique ? `@${technique}` : 'raw';
  const t = technique ? kb.tech?.[techKey(id, technique)] : null;
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
  const effect = technique ? (techniques[technique]?.[cls] ?? null) : null;
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
};

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
  toast: { slots: { base: { need: true, states: ['cooked'] }, anchor: { need: true, states: ANY }, addOn: { states: ANY }, modifier: { states: ANY } } },
  sandwich: { slots: { base: { need: true, states: ANY }, anchor: { need: true, states: ANY }, addOn: { states: ANY }, modifier: { states: ANY } } },
  mash: { slots: { anchor: { need: true, states: ['@mashed', 'cooked'] }, addOn: { states: ANY }, modifier: { states: ANY } } },
  bhurji: { slots: { anchor: { need: true, states: ['cooked'] }, addOn: { states: ANY }, modifier: { states: ANY } } },
  griddle: { slots: { base: { states: ['cooked'] }, anchor: { need: true, states: ['cooked'] }, addOn: { states: ANY }, modifier: { states: ANY } } },
  'one-pot': { slots: { base: { states: ['cooked'] }, anchor: { need: true, states: ['cooked'] }, addOn: { states: ANY }, modifier: { states: ANY } } },
};
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
  };
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

function harmonyOf(slotted, p, kb, techniques, modifiers) {
  const why = [];
  const vs = slotted.map((x) => ({ x, v: partVector(x, kb, techniques) })).filter((r) => r.v);
  const acid = Math.max(0, ...vs.map((r) => r.v.taste.acid), ...modifiers.map((id) => MODIFIERS[id]?.acid ?? 0));
  const sharp = vs.filter((r) => r.v.state === 'raw' && r.v.taste.heat >= SHARP_HEAT).map((r) => r.x.id);
  if (sharp.length && acid < TAMING_ACID) why.push(`clash: raw ${sharp.join(', ')} with nothing sour enough (lemon) to tame it`);
  if (p.mush) why.push(`one texture throughout: all ${p.mush}`);
  const idle = vs.filter((r) => r.x.slot === 'addOn' && (r.v.centre ?? 0) >= 2
    && !TEXTURES.some((k) => r.v.texture[k] >= 2) && !TASTES.some((k) => k !== 'canvas' && r.v.taste[k] >= 2)).map((r) => techKey(r.x.id, r.x.technique));
  if (idle.length) why.push(`clash: ${idle.join(', ')} adds nothing at Medium or above`);
  return why;
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
function belowFloor(p, floor, done = false) {
  const why = [];
  const strong = floor.flavours.filter((k) => (p.brought?.[k] ?? p.taste[k]) >= floor.flavourMin);
  const alone = floor.notAlone ?? [];
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
export function pierreTier(parts, form, { modifiers = [], inventory = [], verdict = null, kb = PIERRE_RAW, techniques = TECHNIQUES, floor = DEFAULT_CONFIG.pierreFloor } = {}) {
  // A rated food named among the modifiers and not among the parts (garlic) is a part of the
  // dish, as it comes. Unrated ones (turmeric) stay ignored, as before.
  const named = new Set(parts.map((x) => (typeof x === 'string' ? x : x.id)));
  parts = [...parts, ...modifiers.filter((id) => !MODIFIERS[id] && !named.has(id) && rawVector(id, kb)).map((id) => ({ id }))];
  modifiers = modifiers.filter((id) => MODIFIERS[id]);
  const grammar = FORMS[form] ?? OPEN_FORM;
  const p = dishProfile(parts, kb, techniques, modifiers);
  const slotted = slotParts(parts, kb);
  const why = [];
  const raw = slotted.filter((x) => x.state === 'raw' && cookFirst(x.id, kb)).map((x) => x.id);
  // Raw garlic vetoes a dish where nothing is cooked (pranjal, 20 Nov: "for now").
  const sharp = slotted.some((x) => x.state !== 'raw') ? [] : slotted.filter((x) => kb.foods?.[x.id]?.vetoUncooked).map((x) => x.id);
  let computed;
  if (p?.inedible.length || raw.length || sharp.length) {
    computed = 'veto';
    if (p?.inedible.length) why.push(`vetoed: ${p.inedible.join(', ')}`);
    if (raw.length) why.push(`raw: ${raw.join(', ')} ${raw.length > 1 ? 'need' : 'needs'} cooking first`);
    if (sharp.length) why.push(`raw ${sharp.join(', ')} in a dish where nothing is cooked`);
  } else {
    for (const [slot, rule] of Object.entries(grammar.slots)) {
      const inSlot = slotted.filter((x) => x.slot === slot);
      if (rule.need && !inSlot.length && !(slot === 'anchor' && slotted.some((x) => x.anchors))) {
        const unrated = slotted.filter((x) => x.centre == null).map((x) => x.id);
        why.push(slot === 'anchor' && unrated.length ? `no anchor (no centre rated for ${unrated.join(', ')})` : `no ${slot}`);
      }
      for (const x of inSlot) if (!stateFits(x.state, rule.states)) why.push(`${techKey(x.id, x.technique)} doesn't fit a ${form}'s ${slot}`);
    }
    for (const x of slotted) if (!grammar.slots[x.slot]) why.push(`a ${form} has no ${x.slot}`);
    if (p?.unfinished.length) why.push(`needs another cooking step: ${p.unfinished.join(', ')}`);
    if (p?.unscored.length) why.push(`can't judge ${p.unscored.join(', ')}: not rated that way`);
    if (p) why.push(...harmonyOf(slotted, p, kb, techniques, modifiers));
    const anchor = slotted.find((x) => x.slot === 'anchor') ?? slotted.find((x) => x.anchors);
    const done = anchor ? partVector(anchor, kb, techniques)?.distance === 0 : false;
    if (!p) why.push('no rated parts');
    else why.push(...belowFloor(p, floor, done));
    computed = why.length ? 'floor' : 'pass';
  }
  let upgrade = null;
  if (computed === 'floor' && p && why.length === belowFloor(p, floor).length && why.length) {
    // Only a taste/texture shortfall can be lifted by adding something.
    const has = new Set([...modifiers, ...parts.map((x) => (typeof x === 'string' ? x : x.id))]);
    const lifts = (extraParts, extraMods) => {
      const q = dishProfile([...parts, ...extraParts], kb, techniques, [...modifiers, ...extraMods]);
      return q && !belowFloor(q, floor).length;
    };
    // Cheapest first: a spice or condiment shaken in, then a rated minor food spooned on.
    // An upgrade keeps the dish's side: a sweet dish (a part at sugar 2+) takes only sweet
    // additions, a savoury one only the rest. Oil is a cooking medium, never an add-on.
    const sweet = (taste) => (taste?.sugar ?? 0) >= 2;
    const dishSweet = parts.some((x) => sweet(partVector(x, kb, techniques)?.taste));
    const sameSide = (taste) => sweet(taste) === dishSweet;
    const spices = inventory.filter((id) => MODIFIERS[id] && id !== 'oil' && !has.has(id) && sameSide(MODIFIERS[id]) && lifts([], [id]));
    const foods = inventory.filter((id) => !has.has(id) && !MODIFIERS[id] && (kb.foods?.[id]?.centre ?? 9) <= 2 && sameSide(kb.foods[id].taste) && lifts([id], [])).sort((a, b) => kb.foods[a].centre - kb.foods[b].centre);
    const all = [...spices, ...foods];
    if (all.length) upgrade = { add: all[0], options: all };
  }
  const mine = verdictTier(verdict);
  const tier = mine ?? computed;
  return { tier, computed, source: mine ? 'verdict' : 'computed', why, upgrade, untested: !!grammar.untested, profile: p };
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
