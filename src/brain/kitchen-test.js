// Kitchen test mode (1.30.0): one kitchen in, three quizzes out, one results file back.
//
//   kitchen JSON ─► buildKitchenTest ─► Pierre quiz  (tier per dish this kitchen can make)
//                                     ─► Marco quiz   (which of two dishes, tired, 9 PM)
//                                     ─► White        (rank() again with those answers) ─► White quiz
//   answers ─► encodeResult ─► "Send to Harvey's" (a GitHub issue + a .json download)
//   scripts/kitchen-tests.mjs reads the files back, scores each brain and fits on all of them.
//
// Answers from a test kitchen train Harvey's like pranjal's own (pranjal, 22 Nov). pranjal
// role-plays a novice who only knows instant noodles, to show Marco what "low friction" really
// means: the fit goes into Marco's shared effort weights, not a per-persona model. Each result
// keeps its kitchen and persona, so it can still be split later.
// Pure: no DOM, no network, no clock, no randomness.

import { CATALOGUE } from './catalogue.js';
import { DEFAULT_CONFIG } from './config.js';
import { buildInventory } from './inventory.js';
import { importKitchens } from './kitchens.js';
import { rank, RUNGS, TIER_ORDER } from './ranker.js';
import { PIERRE_SEED } from './train-data.js';
import { FEATURES, featureVector, fitMarco, fittedWeightsPayload } from './learn.js';
import { slug } from './pantry.js';

export const RESULT_FORMAT = 'harveys-kitchen-test/1';
export const TIERS = ['veto', 'floor', 'pass', 'crave'];
export const MARCO_PICKS = ['a', 'b', 'either', 'neither'];
export const WHITE_ANSWERS = ['yes', 'maybe', 'no'];
/** The moment every test asks about: the tired baseline (no energy picker). */
export const MOMENT = Object.freeze({ hour: 21, weekday: 3, label: 'Weeknight, 9 PM, tired' });
export const TARGETS = Object.freeze({ protein: 60, calories: 1200, fiber: 20 });
export const LIMITS = Object.freeze({ pierre: 24, marco: 12, white: 4 });
/** Pierre tier as featureVector's 0 (fail) … 1 (pass). */
const PIERRE_VALUE = { veto: 0, floor: 0.5, pass: 1, crave: 1 };

/** Stable id: the kitchen's name plus a short hash of its item names. */
export function kitchenId(kitchen) {
  const names = (kitchen.items ?? []).map((i) => String(i.name ?? i).toLowerCase()).sort().join('|');
  let h = 2166136261;
  for (let i = 0; i < names.length; i++) h = Math.imul(h ^ names.charCodeAt(i), 16777619) >>> 0;
  return `${slug(kitchen.kitchen).slice(0, 40) || 'kitchen'}-${h.toString(36).slice(0, 5)}`;
}

/** One or many kitchens (JSON text or objects) → kitchens with ids. */
export function loadKitchens(input) {
  return importKitchens(input).map((k) => ({ ...k, id: kitchenId(k) }));
}

const rankIn = (inventory, { verdicts = PIERRE_SEED, config = DEFAULT_CONFIG, kind = 'meal' } = {}) =>
  rank({ inventory, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind }, catalogue: CATALOGUE, verdicts, config });

/** Every dish this kitchen can make tonight or tomorrow, vetoed ones too (Pierre may disagree). */
function cookable(inventory) {
  const r = rankIn(inventory, { kind: 'any', verdicts: {} });
  const all = [...r.ranked, ...r.tomorrow, ...r.vetoed.map((v) => ({ ...v, raw: null }))];
  const seen = new Set();
  return all.filter((d) => !seen.has(d.meal.id) && seen.add(d.meal.id));
}

const howOf = (meal) => (meal.steps ?? []).map((s) => s.text).join(' ');

/** Plain words for a dish's effort, for the Marco card. */
export function effortFacts(raw) {
  if (!raw) return [];
  return [
    `${Math.round(raw.handsOn)} min hands-on`,
    raw.waiting > 0 ? `${raw.waiting} min waiting` : null,
    raw.prePrepMinutes > 0 ? (raw.prePrepMinutes >= 480 ? 'soak overnight' : `soak ${raw.prePrepMinutes} min`) : null,
    raw.peels > 0 ? `${raw.peels} to peel` : null,
    raw.cuts > 0 ? `${raw.cuts} to cut` : null,
    raw.peels + raw.cuts === 0 ? 'no knife' : null,
    ['walk away', 'check in', 'stay close', 'juggling'][Math.min(3, Math.round(raw.attention ?? 1))],
    `${Math.ceil(raw.cleanup)} to wash`,
  ].filter(Boolean);
}

/**
 * Marco pairs: dishes sorted by friction, each paired with one about half the list away
 * (a clear effort gap) and with its neighbour (a close call). Deterministic.
 */
function marcoPairs(dishes, limit) {
  const list = dishes.filter((d) => d.raw).sort((a, b) => a.friction - b.friction || a.meal.id.localeCompare(b.meal.id));
  const n = list.length;
  if (n < 2) return [];
  const half = Math.max(1, Math.ceil(n / 2));
  // Far pairs (clear gap) and near pairs (close calls) interleaved, spread over the whole list.
  const far = [];
  const near = [];
  for (let i = 0; i + half < n; i++) far.push([list[i], list[i + half]]);
  for (let i = 0; i + 1 < n; i += 2) near.push([list[i], list[i + 1]]);
  const cand = [];
  for (let i = 0; i < Math.max(far.length, near.length); i++) cand.push(...[far[i], near[i]].filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const [x, y] of cand) {
    const key = [x.meal.id, y.meal.id].sort().join('~');
    if (seen.has(key)) continue;
    seen.add(key);
    // Alternate sides so the easier dish isn't always on the left.
    const [a, b] = out.length % 2 ? [y, x] : [x, y];
    out.push({ id: `m${String(out.length + 1).padStart(2, '0')}`, a: a.meal.id, b: b.meal.id });
    if (out.length >= limit) break;
  }
  return out;
}

/** A kitchen → everything the three quizzes need. */
export function buildKitchenTest(kitchen, { cache = {}, limits = LIMITS } = {}) {
  const inventory = buildInventory(kitchen.items, { cache });
  const dishes = cookable(inventory);
  const byId = Object.fromEntries(dishes.map((d) => [d.meal.id, d]));
  const pierre = [...dishes]
    .sort((a, b) => (a.raw ? a.friction : 99) - (b.raw ? b.friction : 99) || a.meal.id.localeCompare(b.meal.id))
    .slice(0, limits.pierre)
    .map((d) => ({ id: d.meal.id, name: d.meal.name, how: howOf(d.meal), harveys: d.pierre.tier, untested: !!d.pierre.untested }));
  const marco = marcoPairs(dishes, limits.marco);
  const dish = (id) => {
    const d = byId[id];
    return { id, name: d.meal.name, how: howOf(d.meal), protein: d.meal.macros?.protein ?? null, facts: effortFacts(d.raw) };
  };
  return {
    id: kitchen.id ?? kitchenId(kitchen),
    kitchen,
    inventory,
    summary: { items: kitchen.items.length, known: inventory.matched.length, unknown: inventory.unmatched, cookable: dishes.length },
    dishes: Object.fromEntries(dishes.map((d) => [d.meal.id, dish(d.meal.id)])),
    pierre,
    marco: marco.map((q) => ({ ...q, A: dish(q.a), B: dish(q.b) })),
    raw: Object.fromEntries(dishes.filter((d) => d.raw).map((d) => [d.meal.id, d.raw])),
  };
}

/** Pierre answers ({dishId: tier}) → rank()'s verdicts, over `base` (default none: Pierre's computed tiers). */
export function verdictsFrom(pierreAnswers = {}, base = {}) {
  const out = { ...base };
  for (const [id, tier] of Object.entries(pierreAnswers)) if (TIERS.includes(tier)) out[id] = { tier, verdict: { veto: 'fail', floor: 'meh' }[tier] ?? 'pass', why: 'kitchen test' };
  return out;
}

/** Marco answers → fitMarco choices (Pierre from the Pierre answers, else Harvey's own tier). */
export function marcoChoices(test, marcoAnswers = {}, pierreAnswers = {}) {
  const tierOf = (id) => pierreAnswers[id] ?? test.pierre.find((p) => p.id === id)?.harveys ?? 'pass';
  return test.marco
    .filter((q) => MARCO_PICKS.includes(marcoAnswers[q.id]) && test.raw[q.a] && test.raw[q.b])
    .map((q) => ({
      id: q.id, pick: marcoAnswers[q.id], mood: 'okay',
      xa: featureVector(test.raw[q.a], PIERRE_VALUE[tierOf(q.a)]),
      xb: featureVector(test.raw[q.b], PIERRE_VALUE[tierOf(q.b)]),
    }));
}

/** fitMarco over choices, pulled toward the weights Harvey's runs on now → a config to rank with. */
export function fitFrom(choices, config = DEFAULT_CONFIG) {
  if (choices.length < 3) return null;
  const prior = FEATURES.map((f) => (f.payoff ? f.prior : config.frictionTheta?.[f.key] ?? f.prior));
  const fit = fitMarco(choices.map(({ xa, xb, pick, mood }) => ({ xa, xb, pick, mood })), { prior });
  // In protein-prior units, like learn.js and refit.js; a positive (effort-is-good) weight is clamped to 0.
  const payload = fittedWeightsPayload(fit);
  const frictionTheta = Object.fromEntries(Object.entries(payload.frictionTheta).map(([k, v]) => [k, v > 0 ? 0 : v]));
  return { n: choices.length, hits: fit.hits, looHits: fit.looHits, priorHits: fit.priorHits, frictionTheta };
}

/** White's answer for this kitchen: the ladder and the one dish it leads with. */
export function whiteFor(test, { pierreAnswers = {}, fit = null, baseVerdicts = {} } = {}) {
  const config = fit ? { ...DEFAULT_CONFIG, frictionTheta: fit.frictionTheta } : DEFAULT_CONFIG;
  const verdicts = verdictsFrom(pierreAnswers, baseVerdicts);
  let r = rankIn(test.inventory, { verdicts, config });
  if (!r.ladder.length) r = rankIn(test.inventory, { verdicts, config, kind: 'any' });
  // Easiest first after macros: the lowest rung leads.
  const ladder = r.ladder.slice(0, LIMITS.white).map((g) => ({
    rung: g.rung, rungName: RUNGS[g.rung], id: g.pick.meal.id, name: g.pick.meal.name,
    how: howOf(g.pick.meal), tier: g.pick.pierre.tier, protein: g.pick.meal.macros?.protein ?? null, facts: effortFacts(g.pick.raw),
  }));
  return { top: ladder[0] ?? null, ladder, unlocks: r.unlocks.map((u) => u.label) };
}

/** Everything a finished (or partly finished) test sends back. Compact: no vectors. */
export function encodeResult(test, state, { version, at, persona = '' } = {}) {
  const p = state.pierre ?? {};
  const m = state.marco ?? {};
  const before = whiteFor(test);
  const fit = fitFrom(marcoChoices(test, m, p));
  const after = whiteFor(test, { pierreAnswers: p, fit });
  return {
    format: RESULT_FORMAT, version, at, kitchenId: test.id, persona: persona || test.kitchen.notes || '',
    kitchen: { kitchen: test.kitchen.kitchen, diet: test.kitchen.diet, notes: test.kitchen.notes, items: test.kitchen.items.map((i) => ({ name: i.name, category: i.category })) },
    moment: MOMENT.label,
    summary: test.summary,
    pierre: test.pierre.filter((q) => p[q.id]).map((q) => ({ dish: q.id, harveys: q.harveys, answer: p[q.id] })),
    marco: test.marco.filter((q) => m[q.id]).map((q) => ({ q: q.id, a: q.a, b: q.b, pick: m[q.id] })),
    fit: fit && { n: fit.n, hits: fit.hits, looHits: fit.looHits, priorHits: fit.priorHits, frictionTheta: fit.frictionTheta },
    white: {
      before: before.ladder.map((d) => d.id),
      after: after.ladder.map((d) => d.id),
      answers: state.white ?? {},
      instead: state.instead ?? null,
    },
  };
}

/** Text (an issue body, a file, pasted JSON) → the result objects in it. */
export function parseResults(text) {
  const out = [];
  const s = String(text ?? '');
  const tryParse = (chunk) => { try { return JSON.parse(chunk); } catch { return null; } };
  const blocks = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const chunk of blocks.length ? blocks : [s]) {
    const v = tryParse(chunk.trim());
    for (const r of Array.isArray(v) ? v : v ? [v] : []) if (r?.format === RESULT_FORMAT) out.push(r);
  }
  return out;
}

/** How each brain did on one result. */
export function scoreResult(r) {
  const pierreHits = r.pierre.filter((x) => x.harveys === x.answer).length;
  const pierreNear = r.pierre.filter((x) => Math.abs(TIER_ORDER[x.harveys] - TIER_ORDER[x.answer]) <= 1).length;
  const w = r.white?.answers ?? {};
  const top = r.white?.after?.[0];
  return {
    kitchen: r.kitchen.kitchen, kitchenId: r.kitchenId,
    pierre: { n: r.pierre.length, exact: pierreHits, withinOne: pierreNear },
    marco: { n: r.marco.length, fitHits: r.fit?.hits ?? null, looHits: r.fit?.looHits ?? null, priorHits: r.fit?.priorHits ?? null },
    white: { top, topAnswer: top ? w[top] ?? null : null, yes: Object.values(w).filter((v) => v === 'yes').length, asked: Object.keys(w).length, instead: r.white?.instead ?? null },
  };
}
