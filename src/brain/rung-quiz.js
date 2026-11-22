// Rung quiz (1.31.0, groups and one-tap send 1.32.0): the user-testing flow after Proceed.
//
//   kitchen ─► buildRungQuiz ─► Marco section  (sort each rung: easiest on top)
//                             ─► Pierre section (sort each rung: tastiest on top)
//                             ─► White section  (tap what you'd actually cook, in order, and why)
//   answers ─► encodeRungResult ─► "Send to Harvey's" (straight into the repo, see src/send.js)
//   scripts/kitchen-tests.mjs score reads these files next to the kitchen-test ones.
//
// A full ranking of n dishes is n(n−1)/2 pairwise choices, so one drag gives Marco many more
// training pairs than the old pick-one-of-two. Every result carries each dish's raw effort
// features, so scoring never has to rebuild the kitchen (and today's catalogue can't drift it).
// Pure: no DOM, no network, no clock, no randomness (shuffles are seeded by the kitchen id).

import { CATALOGUE } from './catalogue.js';
import { DEFAULT_CONFIG } from './config.js';
import { rank, RUNGS, TIER_ORDER, byRungOrder, describeMissing } from './ranker.js';
import { CAPABILITIES } from './vocabulary.js';
import { PIERRE_SEED } from './train-data.js';
import { featureVector } from './learn.js';
import { kitchenId, effortFacts, MOMENT, TARGETS, fitFrom } from './kitchen-test.js';
import { ingredientUsage, usageForResult } from './usage.js';
import { cleanFeedback } from './feedback.js';

export const RUNG_FORMAT = 'harveys-rung-quiz/1';
/** Most dishes a tester sorts on one rung: Harvey's top ones (more is a chore on a phone). */
export const PER_RUNG = 5;
/**
 * Thin kitchens (1.37.0): with fewer cookable dishes than this, the quiz adds dishes that are one
 * missing thing away, marked "Needs …". Ranking effort doesn't need the kitchen to have it all,
 * and Harsh's and Banana Singh's tests (22 Nov) each got one dish and no Marco sort at all.
 */
export const THIN_KITCHEN = 4;
/** Most dishes a thin kitchen's quiz grows to, cookable and one-away together. */
export const THIN_FILL = 8;
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
 * An inventory (buildInventory's) → the quiz: groups of up to PER_RUNG dishes in Harvey's own
 * order (easier rung first, then byRungOrder), plus a shown order per section.
 *
 * Sorting or picking from one dish tells us nothing, so a rung with a single dish is merged
 * into its neighbour (the smaller one; the easier one on a tie). A merged group keeps the
 * lower rung as its key and lists every rung it spans in `rungs`, and its Marco pairs cross
 * the rung line, which also tests the ladder itself. A merged group may hold PER_RUNG + 1
 * dishes; past that the bigger rung's last dish makes room. Only a kitchen with one dish in
 * all leaves a group of one (White only, no sorts).
 */
export function buildRungQuiz({ kitchen, inventory, catalogue = CATALOGUE, verdicts = PIERRE_SEED, config = DEFAULT_CONFIG }) {
  const id = kitchenId(kitchen);
  const go = (kind) => rank({ inventory, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind }, catalogue, verdicts, config });
  let kind = 'meal';
  let r = go(kind);
  if (!r.ranked.length) r = go(kind = 'any');
  const pool = r.ranked.length < THIN_KITCHEN
    ? [...r.ranked, ...oneAway({ r, kind, inventory, catalogue, verdicts, config }).slice(0, THIN_FILL - r.ranked.length)]
    : r.ranked;
  // Cookable dishes lead their rung, so White's "Harvey's pick" is always one you can make.
  const realFirst = (a, b) => (a.away ? 1 : 0) - (b.away ? 1 : 0) || byRungOrder(a, b);
  const byRung = {};
  let groups = [];
  for (const rung of [1, 2, 3, 4]) {
    const items = pool.filter((x) => x.rung === rung).sort(realFirst).slice(0, PER_RUNG);
    if (!items.length) continue;
    byRung[rung] = items;
    groups.push({ rungs: [rung], items });
  }
  // Merge every one-dish group into a neighbour until none is left (or only one group).
  for (let i = groups.findIndex((g) => g.items.length < 2); i >= 0 && groups.length > 1; i = groups.findIndex((g) => g.items.length < 2)) {
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const j = !next || (prev && prev.items.length <= next.items.length) ? i - 1 : i + 1;
    const [a, b] = j < i ? [groups[j], groups[i]] : [groups[i], groups[j]];
    const big = a.items.length >= b.items.length ? a : b;
    while (a.items.length + b.items.length > PER_RUNG + 1) big.items.pop();
    groups.splice(Math.min(i, j), 2, { rungs: [...a.rungs, ...b.rungs], items: [...a.items, ...b.items] });
  }
  const dishes = {};
  const rungs = groups.map((grp) => {
    grp.items.forEach((x) => {
      dishes[x.meal.id] = {
        id: x.meal.id, name: x.meal.name, rung: x.rung, how: x.away ? `Needs ${x.away} · ${shortHow(x.meal)}` : shortHow(x.meal), facts: effortFacts(x.raw),
        ...(x.away ? { away: x.away } : {}),
        protein: x.meal.macros?.protein ?? null, kcal: x.meal.macros?.kcal ?? null,
        harveys: { order: byRung[x.rung].indexOf(x), tier: x.pierre.tier, friction: round(x.friction), score: round(x.score) },
        raw: compactRaw(x.raw),
      };
    });
    const ids = grp.items.map((x) => x.meal.id);
    // White asks what you'd actually cook, so it shows only dishes this kitchen can make.
    const real = grp.items.filter((x) => !x.away).map((x) => x.meal.id);
    const key = grp.rungs[0];
    return {
      rung: key, rungs: grp.rungs, name: grp.rungs.map((n) => RUNGS[n]).join(' + '), dishes: ids, pick: real[0] ?? null,
      shown: { marco: seededShuffle(ids, `${id}|marco|${key}`), pierre: seededShuffle(ids, `${id}|pierre|${key}`), white: real.length > 1 ? seededShuffle(real, `${id}|white|${key}`) : real },
    };
  });
  const sortable = rungs.filter((g) => g.dishes.length > 1);
  const steps = [
    ...sortable.map((g) => ({ section: 'marco', rung: g.rung })),
    ...sortable.map((g) => ({ section: 'pierre', rung: g.rung })),
    ...rungs.filter((g) => g.shown.white.length).map((g) => ({ section: 'white', rung: g.rung })),
  ];
  // 1.33.0: every listed item, used or not, and why not (src/brain/usage.js).
  const usage = ingredientUsage({ items: kitchen.items ?? [], inventory, ranking: r, shown: Object.keys(dishes), catalogue, kind, config });
  return { id, kitchen, rungs, dishes, steps, usage };
}

/**
 * Dishes blocked by exactly one thing (kit or food), ranked as if the kitchen had it, Harvey's
 * order (tier, then score). Each carries `away`: the missing thing in words ("a pan").
 */
function oneAway({ r, kind, inventory, catalogue, verdicts, config }) {
  const out = [];
  for (const f of r.filtered ?? []) {
    if (kind !== 'any' && f.meal.kind !== kind) continue;
    const need = [...f.missing.equipment, ...f.missing.ingredients.map((opts) => opts[0])];
    if (need.length !== 1 || String(need[0]).startsWith('role:')) continue;
    const id = CAPABILITIES[need[0]]?.anyOf[0] ?? need[0];
    const inv = { ...inventory, have: new Set([...inventory.have, id]), missingBasics: new Set([...(inventory.missingBasics ?? [])].filter((u) => u !== need[0])) };
    const x = rank({ inventory: inv, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind }, catalogue: [f.meal], verdicts, config }).ranked[0];
    if (x) out.push({ ...x, away: describeMissing(f.missing)[0] });
  }
  return out.sort((a, b) => TIER_ORDER[b.pierre.tier] - TIER_ORDER[a.pierre.tier] || b.score - a.score || a.meal.id.localeCompare(b.meal.id));
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
export function encodeRungResult(quiz, answers, { version, at, testerId, runNo = null, source = 'paste', tester = '' } = {}) {
  const shownOf = (g, s) => g.shown[s];
  const sortRows = (section) => quiz.rungs.filter((g) => answers[section]?.[g.rung]).map((g) => {
    const a = answers[section][g.rung];
    return { rung: g.rung, rungs: g.rungs ?? [g.rung], harveys: g.dishes, shown: shownOf(g, section), ranking: a.ranking, moved: !!a.moved, ms: a.ms ?? null };
  });
  return {
    format: RUNG_FORMAT, version, at, source,
    kitchenId: quiz.id, testerId, runNo,
    // 1.35.0: the first name pranjal put in the share link; left out when there's none.
    ...(tester ? { tester: String(tester).slice(0, 40) } : {}),
    kitchen: { kitchen: quiz.kitchen.kitchen, diet: quiz.kitchen.diet ?? 'unknown', notes: quiz.kitchen.notes ?? '', items: (quiz.kitchen.items ?? []).map((i) => ({ name: i.name, category: i.category })) },
    moment: MOMENT.label, targets: TARGETS,
    directions: { marco: 'easiest first', pierre: 'tastiest first', white: 'tap order = preference' },
    // From 1.32.0 an unmoved sort was confirmed with a "Keep this order" tap, so it is a real answer.
    unmovedConfirmed: true,
    // 1.33.0: what the kitchen had that no shown dish used, and why: catalogue gaps across kitchens.
    ingredients: quiz.usage ? usageForResult(quiz.usage) : null,
    dishes: Object.fromEntries(Object.values(quiz.dishes).map((d) => [d.id, { name: d.name, rung: d.rung, harveys: d.harveys, raw: d.raw, ...(d.away ? { away: d.away } : {}) }])),
    marco: sortRows('marco'),
    pierre: sortRows('pierre'),
    white: quiz.rungs.filter((g) => answers.white?.[g.rung]).map((g) => {
      const a = answers.white[g.rung];
      return { rung: g.rung, rungs: g.rungs ?? [g.rung], harveys: g.pick === undefined ? g.dishes[0] : g.pick, shown: g.shown.white, picks: a.none ? [] : a.picks, none: !!a.none, criteria: a.criteria ?? [], ms: a.ms ?? null };
    }),
    // 1.34.0: what the tester said went wrong (src/brain/feedback.js). null: never reached it.
    feedback: cleanFeedback(answers.feedback, quiz),
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
  // Harvey's easiest-first is the ladder: rung first (merged groups cross rungs), then friction.
  const easyOrder = (ids) => [...ids].sort((x, y) => r.dishes[x].rung - r.dishes[y].rung || r.dishes[x].harveys.friction - r.dishes[y].harveys.friction || x.localeCompare(y));
  const tasteOrder = (ids) => [...ids].sort((x, y) => TIER_ORDER[r.dishes[y].harveys.tier] - TIER_ORDER[r.dishes[x].harveys.tier] || r.dishes[x].rung - r.dishes[y].rung || r.dishes[x].harveys.order - r.dishes[y].harveys.order);
  const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
  const marco = r.marco.map((m) => ({ rung: m.rung, tau: kendall(easyOrder(m.ranking), m.ranking), moved: m.moved }));
  const pierre = r.pierre.map((p) => ({ rung: p.rung, tau: kendall(tasteOrder(p.ranking), p.ranking), moved: p.moved }));
  const white = r.white.map((w) => ({ rung: w.rung, harveys: w.harveys, first: w.picks[0] ?? null, hit: w.picks[0] === w.harveys, inPicks: w.picks.includes(w.harveys), criteria: w.criteria }));
  const criteria = {};
  for (const w of r.white) w.criteria.forEach((c, i) => { criteria[c] = (criteria[c] ?? 0) + (w.criteria.length - i); });
  return {
    kitchen: r.kitchen.kitchen, kitchenId: r.kitchenId, testerId: r.testerId, tester: r.tester ?? '', unmovedConfirmed: !!r.unmovedConfirmed,
    marco: { rungs: marco, tau: mean(marco.map((x) => x.tau)), pairs: rungMarcoChoices(r).length },
    pierre: { rungs: pierre, tau: mean(pierre.map((x) => x.tau)) },
    white: { rungs: white, hits: white.filter((x) => x.hit).length, inPicks: white.filter((x) => x.inPicks).length, n: white.length, criteria },
  };
}

export { fitFrom };

/**
 * One result per tester and kitchen (1.37.0): the latest. A named tester who sends again (Banana
 * Singh sent runs 2 and 3 a minute apart, 22 Nov) redid the test, so the earlier run is dropped.
 * Each run has its own testerId, so a named tester is matched by name; an unnamed one never merges.
 */
export function latestRuns(results) {
  const best = new Map();
  for (const r of results) {
    const who = r.tester ? `name:${String(r.tester).trim().toLowerCase()}` : `id:${r.testerId}`;
    const key = `${who}|${r.kitchenId}`;
    const prev = best.get(key);
    if (!prev || String(r.at ?? '') > String(prev.at ?? '')) best.set(key, r);
  }
  return results.filter((r) => [...best.values()].includes(r));
}

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
