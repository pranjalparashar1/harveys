// Rung quiz (1.31.0): the user-testing flow after Proceed.
//
//   kitchen ─► buildRungQuiz ─► Marco section  (sort each rung: easiest on top)
//                             ─► Pierre section (sort each rung: tastiest on top)
//                             ─► White section  (tap what you'd actually cook, in order, and why)
//   answers ─► encodeRungResult ─► "Send to Harvey's" (share sheet, file, or GitHub issue)
//   scripts/kitchen-tests.mjs score reads these files next to the kitchen-test ones.
//
// A full ranking of n dishes is n(n−1)/2 pairwise choices, so one drag gives Marco many more
// training pairs than the old pick-one-of-two. Every result carries each dish's raw effort
// features, so scoring never has to rebuild the kitchen (and today's catalogue can't drift it).
// Pure: no DOM, no network, no clock, no randomness (shuffles are seeded by the kitchen id).

import { CATALOGUE } from './catalogue.js';
import { DEFAULT_CONFIG } from './config.js';
import { rank, RUNGS, TIER_ORDER, byRungOrder } from './ranker.js';
import { PIERRE_SEED } from './train-data.js';
import { featureVector } from './learn.js';
import { kitchenId, effortFacts, MOMENT, TARGETS, fitFrom } from './kitchen-test.js';

export const RUNG_FORMAT = 'harveys-rung-quiz/1';
/** Most dishes a tester sorts on one rung: Harvey's top ones (more is a chore on a phone). */
export const PER_RUNG = 5;
export const CRITERIA = [
  { id: 'macros', label: 'Macros' },
  { id: 'difficulty', label: 'Effort' },
  { id: 'taste', label: 'Taste' },
];
const PIERRE_VALUE = { veto: 0, floor: 0.5, pass: 1, crave: 1 };

/** Seeded shuffle (mulberry32 over an FNV hash of `seed`), never left in the order given. */
export function seededShuffle(list, seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const rnd = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((x, i) => x === list[i])) out.reverse();
  return out;
}

const shortHow = (meal) => {
  const names = (meal.ingredients ?? []).map((i) => i.name ?? i.id ?? i.anyOf?.[0]).filter(Boolean);
  return names.slice(0, 5).join(', ').replace(/_/g, ' ');
};

/**
 * An inventory (buildInventory's) → the quiz: rungs with up to PER_RUNG dishes in Harvey's own
 * order, plus a shown order per section. Rungs with one dish skip the sorts but stay in White.
 */
export function buildRungQuiz({ kitchen, inventory, catalogue = CATALOGUE, verdicts = PIERRE_SEED, config = DEFAULT_CONFIG }) {
  const id = kitchenId(kitchen);
  const go = (kind) => rank({ inventory, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind }, catalogue, verdicts, config });
  let r = go('meal');
  if (!r.ranked.length) r = go('any');
  const dishes = {};
  const rungs = [];
  for (const rung of [1, 2, 3, 4]) {
    const items = r.ranked.filter((x) => x.rung === rung).sort(byRungOrder).slice(0, PER_RUNG);
    if (!items.length) continue;
    items.forEach((x, i) => {
      dishes[x.meal.id] = {
        id: x.meal.id, name: x.meal.name, rung, how: shortHow(x.meal), facts: effortFacts(x.raw),
        protein: x.meal.macros?.protein ?? null, kcal: x.meal.macros?.kcal ?? null,
        harveys: { order: i, tier: x.pierre.tier, friction: round(x.friction), score: round(x.score) },
        raw: compactRaw(x.raw),
      };
    });
    const ids = items.map((x) => x.meal.id);
    rungs.push({
      rung, name: RUNGS[rung], dishes: ids,
      shown: { marco: seededShuffle(ids, `${id}|marco|${rung}`), pierre: seededShuffle(ids, `${id}|pierre|${rung}`), white: seededShuffle(ids, `${id}|white|${rung}`) },
    });
  }
  const sortable = rungs.filter((g) => g.dishes.length > 1);
  const steps = [
    ...sortable.map((g) => ({ section: 'marco', rung: g.rung })),
    ...sortable.map((g) => ({ section: 'pierre', rung: g.rung })),
    ...rungs.map((g) => ({ section: 'white', rung: g.rung })),
  ];
  return { id, kitchen, rungs, dishes, steps };
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);
function compactRaw(raw) {
  if (!raw) return null;
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, round(v)]));
}

/**
 * Answers → the file a tester sends. answers: { marco: {rung: {ranking, ms, moved}},
 * pierre: {…same}, white: {rung: {picks, none, criteria, ms}} }.
 */
export function encodeRungResult(quiz, answers, { version, at, testerId, tester = '', source = 'paste' } = {}) {
  const shownOf = (g, s) => g.shown[s];
  const sortRows = (section) => quiz.rungs.filter((g) => answers[section]?.[g.rung]).map((g) => {
    const a = answers[section][g.rung];
    return { rung: g.rung, harveys: g.dishes, shown: shownOf(g, section), ranking: a.ranking, moved: !!a.moved, ms: a.ms ?? null };
  });
  return {
    format: RUNG_FORMAT, version, at, source,
    kitchenId: quiz.id, testerId, tester,
    kitchen: { kitchen: quiz.kitchen.kitchen, diet: quiz.kitchen.diet ?? 'unknown', notes: quiz.kitchen.notes ?? '', items: (quiz.kitchen.items ?? []).map((i) => ({ name: i.name, category: i.category })) },
    moment: MOMENT.label, targets: TARGETS,
    directions: { marco: 'easiest first', pierre: 'tastiest first', white: 'tap order = preference' },
    dishes: Object.fromEntries(Object.values(quiz.dishes).map((d) => [d.id, { name: d.name, rung: d.rung, harveys: d.harveys, raw: d.raw }])),
    marco: sortRows('marco'),
    pierre: sortRows('pierre'),
    white: quiz.rungs.filter((g) => answers.white?.[g.rung]).map((g) => {
      const a = answers.white[g.rung];
      return { rung: g.rung, harveys: g.dishes[0], shown: g.shown.white, picks: a.none ? [] : a.picks, none: !!a.none, criteria: a.criteria ?? [], ms: a.ms ?? null };
    }),
  };
}

// ── Scoring (used by scripts/kitchen-tests.mjs) ─────────────────────────────

/** Kendall's tau between two orders of the same ids (1 = same, −1 = reversed). */
export function kendall(a, b) {
  const pos = new Map(b.map((x, i) => [x, i]));
  const ids = a.filter((x) => pos.has(x));
  let c = 0;
  let d = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) (pos.get(ids[i]) < pos.get(ids[j]) ? c++ : d++);
  return c + d ? round((c - d) / (c + d)) : null;
}

/** Every pair in each Marco ranking → fitMarco choices (the higher one is the pick). */
export function rungMarcoChoices(result) {
  const out = [];
  for (const row of result.marco ?? []) {
    const r = row.ranking ?? [];
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const easier = result.dishes[r[i]];
      const harder = result.dishes[r[j]];
      if (!easier?.raw || !harder?.raw) continue;
      const xe = featureVector(easier.raw, PIERRE_VALUE[easier.harveys.tier] ?? 1);
      const xh = featureVector(harder.raw, PIERRE_VALUE[harder.harveys.tier] ?? 1);
      // Alternate sides so "a" isn't always the pick.
      const flip = out.length % 2 === 1;
      out.push({ id: `${row.rung}:${r[i]}>${r[j]}`, pick: flip ? 'b' : 'a', mood: 'okay', xa: flip ? xh : xe, xb: flip ? xe : xh });
    }
  }
  return out;
}

/** How Harvey's did on one rung-quiz result. */
export function scoreRungResult(r) {
  const easyOrder = (ids) => [...ids].sort((x, y) => r.dishes[x].harveys.friction - r.dishes[y].harveys.friction || x.localeCompare(y));
  const tasteOrder = (ids) => [...ids].sort((x, y) => TIER_ORDER[r.dishes[y].harveys.tier] - TIER_ORDER[r.dishes[x].harveys.tier] || r.dishes[x].harveys.order - r.dishes[y].harveys.order);
  const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
  const marco = r.marco.map((m) => ({ rung: m.rung, tau: kendall(easyOrder(m.ranking), m.ranking), moved: m.moved }));
  const pierre = r.pierre.map((p) => ({ rung: p.rung, tau: kendall(tasteOrder(p.ranking), p.ranking), moved: p.moved }));
  const white = r.white.map((w) => ({ rung: w.rung, harveys: w.harveys, first: w.picks[0] ?? null, hit: w.picks[0] === w.harveys, inPicks: w.picks.includes(w.harveys), criteria: w.criteria }));
  const criteria = {};
  for (const w of r.white) w.criteria.forEach((c, i) => { criteria[c] = (criteria[c] ?? 0) + (w.criteria.length - i); });
  return {
    kitchen: r.kitchen.kitchen, kitchenId: r.kitchenId, testerId: r.testerId, tester: r.tester,
    marco: { rungs: marco, tau: mean(marco.map((x) => x.tau)), pairs: rungMarcoChoices(r).length },
    pierre: { rungs: pierre, tau: mean(pierre.map((x) => x.tau)) },
    white: { rungs: white, hits: white.filter((x) => x.hit).length, inPicks: white.filter((x) => x.inPicks).length, n: white.length, criteria },
  };
}

export { fitFrom };

/** Text (an issue body, a shared file, a pasted message) → the rung-quiz results in it. */
export function parseRungResults(text) {
  const out = [];
  const s = String(text ?? '');
  const tryParse = (chunk) => { try { return JSON.parse(chunk); } catch { return null; } };
  const blocks = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const chunk of blocks.length ? blocks : [s]) {
    const v = tryParse(chunk.trim());
    for (const r of Array.isArray(v) ? v : v ? [v] : []) if (r?.format === RUNG_FORMAT) out.push(r);
  }
  return out;
}
