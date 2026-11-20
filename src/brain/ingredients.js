// The ingredient knowledge base: Pierre's raw layer, plus how central each food
// is to a meal. Everything here is pure (no DOM, no network) so it can be
// ported to MarcoCore.
//
// Three layers, bottom to top:
//   1. raw     what a food is on its own        (Pierre-trainer, src/brain/pierre-raw.js)
//   2. tech    what a technique does to it      (Pierre-tutor, later: "fried paneer")
//   3. dish    a plate built from parts         (dishProfile, plateShape)
// A dish is scored from its parts, so Pierre can judge any dish, including
// wacky AI ones, as long as it knows the parts.
import { PIERRE_RAW } from './pierre-raw.js';

export const TEXTURES = ['crisp', 'creamy', 'chewy', 'juicy', 'flaky'];
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
    texture: Object.fromEntries(TEXTURES.map((k) => [k, clamp(f.texture?.[k] ?? 0, 0, 3)])),
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

// ── Techniques (Pierre-tutor fills these) ───────────────────────────────────
// A technique either has a rating of its own for a specific food ("paneer@pan_fried",
// rated in Pierre-tutor and kept in the brain file's `tech`), or a general effect
// that shifts any raw vector: { texture: { crisp: +2 }, taste: { fat: 1 } }.
// Empty for now: no guesses until there are real ratings.
export const TECHNIQUES = {};
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

/** The vector for one part of a dish: a food, optionally cooked a certain way. */
export function partVector(part, kb = PIERRE_RAW, techniques = TECHNIQUES) {
  const { id, technique } = typeof part === 'string' ? { id: part } : part;
  const t = technique ? kb.tech?.[techKey(id, technique)] : null;
  if (t) {
    return {
      id,
      technique,
      texture: Object.fromEntries(TEXTURES.map((k) => [k, clamp(t.texture?.[k] ?? 0, 0, 3)])),
      taste: Object.fromEntries(TASTES.map((k) => [k, clamp(t.taste?.[k] ?? 0, 0, 3)])),
      centre: rawVector(id, kb)?.centre ?? kb.prep?.[id]?.centre ?? 3, // prep-only foods (eggs, whey) carry theirs on the prep entry
      distance: t.distance ?? null,
      veto: !!t.veto,
      source: 'rated',
    };
  }
  const raw = rawVector(id, kb);
  if (!raw) return null;
  const effect = technique ? techniques[technique] : null;
  if (!effect) return { ...raw, technique: technique ?? null, source: technique ? 'raw (technique not learned yet)' : 'raw' };
  return {
    ...raw,
    technique,
    texture: Object.fromEntries(TEXTURES.map((k) => [k, clamp(raw.texture[k] + (effect.texture?.[k] ?? 0), 0, 3)])),
    taste: Object.fromEntries(TASTES.map((k) => [k, clamp(raw.taste[k] + (effect.taste?.[k] ?? 0), 0, 3)])),
    source: 'technique',
  };
}

/**
 * What a dish tastes and feels like, from its parts. Texture is the
 * centre-weighted mean (the anchor dominates); taste is what any part brings.
 * `textures` counts distinct textures at medium or above, the left side of
 * Pierre's Couvert. Spoons aren't computed here: their weights come from real
 * verdicts, not guesses.
 */
export function dishProfile(parts, kb = PIERRE_RAW, techniques = TECHNIQUES) {
  const vs = parts.map((p) => partVector(p, kb, techniques)).filter(Boolean);
  if (!vs.length) return null;
  const total = vs.reduce((s, v) => s + pullOf(v.centre), 0);
  const texture = Object.fromEntries(TEXTURES.map((k) => [k, vs.reduce((s, v) => s + pullOf(v.centre) * v.texture[k], 0) / total]));
  // Flavours: the strongest any part brings. Canvas: centre-weighted, like texture
  // (a dish anchored on tofu stays a canvas even with a little salty cheese).
  const taste = Object.fromEntries(TASTES.map((k) => [k, k === 'canvas'
    ? vs.reduce((s, v) => s + pullOf(v.centre) * v.taste[k], 0) / total
    : Math.max(...vs.map((v) => v.taste[k]))]));
  return {
    texture,
    taste,
    textures: TEXTURES.filter((k) => texture[k] >= 1.5),
    tastes: TASTES.filter((k) => k !== 'canvas' && taste[k] > 0),
    shape: plateShape(vs.map((v) => v.id), kb),
    missing: parts.map((p) => (typeof p === 'string' ? p : p.id)).filter((id) => !rawVector(id, kb)),
    // Distance of the cooked parts: a veto rules the dish out (microwaved eggs); 3 needs
    // another cooking step (fine in a chain, not as the last technique); 0–2 are what
    // Marco still has to add. `finish` maps each part to what's left to do.
    inedible: vs.filter((v) => v.veto).map((v) => techKey(v.id, v.technique)),
    unfinished: vs.filter((v) => v.distance === 3).map((v) => techKey(v.id, v.technique)),
    finish: Object.fromEntries(vs.filter((v) => v.distance != null).map((v) => [techKey(v.id, v.technique), DISTANCE[v.distance]])),
  };
}

// ── Ratings in, brain file out ──────────────────────────────────────────────
/**
 * Merges quiz ratings ({ id: { texture, taste, centre, prep, at } }) into a brain file. Newer wins.
 * A food is rated (it has a centre), part of prep (`prep: true`, "needs further processing",
 * like soaked poha), or both (paneer). Prep foods are listed in `prep`, where Pierre-tutor
 * starts; a food that is only prep has no raw ratings.
 */
// centres: { whey: 4 } gives a prep-only food its centre 1–5 (Step 2), kept on its prep entry.
export function mergeRatings(kb, ratings, { exclude = [], centres = {} } = {}) {
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
        texture: Object.fromEntries(TEXTURES.map((k) => [k, clamp(Math.round(r.texture?.[k] ?? 0), 0, 3)])),
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
      texture: Object.fromEntries(TEXTURES.map((k) => [k, clamp(Math.round(r.texture?.[k] ?? 0), 0, 3)])),
      taste: Object.fromEntries(TASTES.map((k) => [k, clamp(Math.round(r.taste?.[k] ?? 0), 0, 3)])),
      ...(r.tasteAssumed ? { tasteAssumed: true } : {}),
      centre: clamp(Math.round(r.centre ?? 2), 1, 5),
      role: roleOf(r.centre ?? 2),
      ...(r.at ? { at: r.at } : {}),
    };
  }
  for (const [id, c] of Object.entries(centres)) {
    if (!prep[id]) throw new Error(`${id} is not a prep-only food; rate its centre in the quiz`);
    prep[id] = { ...prep[id], centre: clamp(Math.round(c), 1, 5) };
  }
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return { ...kb, foods: sorted(foods), prep: sorted(prep), ...(Object.keys(tech).length ? { tech: sorted(tech) } : {}), excluded: [...new Set(excluded)].sort() };
}

function clamp(x, lo, hi) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
