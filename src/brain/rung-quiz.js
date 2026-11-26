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
import { CAPABILITIES, labelFor, kindOf } from './vocabulary.js';
import { PIERRE_SEED } from './train-data.js';
import { featureVector } from './learn.js';
import { kitchenId, effortFacts, MOMENT, TARGETS, fitFrom } from './kitchen-test.js';
import { ingredientUsage, usageForResult } from './usage.js';
import { cleanFeedback } from './feedback.js';
import { withConfirmed } from './confirm.js';
import { expandTemplates } from './templates.js';

export const RUNG_FORMAT = 'harveys-rung-quiz/1';
/** Most dishes a tester sorts on one rung: Harvey's top ones (more is a chore on a phone). */
export const PER_RUNG = 5;
/**
 * Thin kitchens (1.37.0): with fewer cookable dishes than this, the quiz adds dishes that are one
 * missing thing away, marked "Needs …". Ranking effort doesn't need the kitchen to have it all,
 * and Harsh's and Banana Singh's tests (22 Nov) each got one dish and no Marco sort at all.
 */
export const THIN_KITCHEN = 4;
/** Most dishes a thin kitchen's quiz grew to, cookable and one-away together (unused from 1.50.0). */
export const THIN_FILL = 8;
/**
 * 1.49.0: most dishes a tester rates. PER_RUNG alone left Banana Singh (23 Nov) rating 8 of
 * 21 cookable dishes: 18 sat on rung 3, so the paneer dishes she unlocked never showed. Free
 * slots now go to the rest, dishes the tester's added items unlocked (`prefer`) first.
 */
// pranjal, 23 Nov: "let them rate all dishes, it's fine": no cap, every cookable dish is rated.
// 1.54.0 (pranjal, 24 Nov): open-slot templates make far more dishes (the L5 kitchen opens 100+),
// so a tester rates about 12, stratified across rungs (see stratify()).
// 1.57.0 (pranjal, 26 Nov: "give all possible recipes and I'll rate as many myself"): no cap
// again. The deck is every dish the kitchen opens, in a stratified order (rateOrderOf), so a
// rater who taps "Done with quiz" early still leaves a spread across rungs and templates.
export const DECK_MAX = Infinity;
/** 1.57.0: one-tap reasons for a low taste rating (1 or 2 stars). Optional, never blocks Next. */
export const TASTE_WHY = [
  { id: 'ingredient', label: 'Don’t like an ingredient' },
  { id: 'odd', label: 'Odd combination' },
  { id: 'bland', label: 'Bland' },
  { id: 'texture', label: 'Dry or all one texture' },
  { id: 'filling', label: 'Not filling' },
];
/**
 * 1.57.0: the order dishes are rated in. stratify()'s round-robin (rung 1, 2, 3, 4, 1, …), each
 * round shuffled by seed, so stopping at any point leaves an even spread across rungs, and the
 * position still says nothing about effort (the 1.48.0 reason for shuffling at all).
 */
export function rateOrderOf(ordered, seed) {
  const out = [];
  let round = [];
  const flush = (n) => { out.push(...(round.length > 1 ? seededShuffle(round, `${seed}|${n}`) : round)); round = []; };
  ordered.forEach((x) => {
    if (round.some((y) => y.rung === x.rung)) flush(out.length);
    round.push(x);
  });
  flush(out.length);
  return out.map((x) => x.meal.id);
}
export const CRITERIA = [
  { id: 'macros', label: 'Macros' },
  { id: 'difficulty', label: 'Effort' },
  { id: 'taste', label: 'Taste' },
];
const PIERRE_VALUE = { veto: 0, floor: 0.5, pass: 1, crave: 1 };
/**
 * 1.42.0 meal cards: after the quick check the tester sees each dish on a card ("Would you make
 * this?", yes or no), then can rate how hard each one is. A "no" may carry why. Levels are for a
 * tired weeknight, 9 PM; any two dishes rated apart are one Marco pair (lower = easier).
 */
export const WHY_NOT = [
  { id: 'effort', label: 'Too much effort' },
  { id: 'taste', label: 'Not my taste' },
  { id: 'missing', label: 'Missing something' },
  { id: 'unknown', label: 'Don’t know it' },
];
/**
 * 1.43.0 recipe test: no cards. Every dish is a row with two star rows, effort and taste
 * (5 = effortless / delicious), and "Can't make it" with a reason. Effort stars fold into the
 * difficulty scale below (level = 6 − stars), so they make the same Marco pairs.
 */
export const CANT = [
  { id: 'ingredients', label: 'Missing ingredients' },
  { id: 'equipment', label: 'Missing equipment' },
];
export const EFFORT_STARS = ['Too much work', 'Hard work', 'Some effort', 'Easy', 'Effortless'];
export const TASTE_STARS = ['Wouldn’t eat it', 'Meh', 'Fine', 'Tasty', 'Delicious'];
export const DIFFICULTY = [
  { level: 1, label: 'Effortless', hint: 'Barely cooking' },
  { level: 2, label: 'Easy', hint: 'A few minutes' },
  { level: 3, label: 'Some effort', hint: 'Doable tonight' },
  { level: 4, label: 'Hard work', hint: 'Only if I must' },
  { level: 5, label: 'Too much tonight', hint: 'Not when tired' },
];

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

/**
 * 1.54.0 (pranjal, 24 Nov): about `max` dishes, stratified across rungs. Slots go round the
 * rungs (1, 2, 3, 4, 1, 2…) so every rung the kitchen reaches is rated; within a rung, dishes the
 * tester's additions unlocked go first, then Harvey's order. Written templates and opened variants
 * alternate, and a template's second variant waits until every other template on that rung has
 * had one (no three paneer tikkas).
 *
 * 1.55.0: `fresh` = dishes this kitchen opens that the persona level below it doesn't. They go
 * next after `prefer`. The persona kitchens are cumulative, so without this every level from L2
 * up got the same easiest dishes at the top of each rung (Harvey's order is the same everywhere)
 * and the testers at L2, L3 and L4 rated mostly the same Maggi and oats. Lower-level dishes
 * still fill a rung that has too few new ones, which keeps a few shared dishes across levels.
 */
export function stratify(pool, { max = DECK_MAX, prefer = null, fresh = null } = {}) {
  const real = pool.filter((x) => !x.away);
  const root = (x) => x.meal.template?.from ?? x.meal.id;
  const first = (x) => (prefer?.has(x.meal.id) ? 0 : fresh?.has(x.meal.id) ? 1 : 2);
  const queues = {};
  for (const rung of [1, 2, 3, 4]) {
    const list = real.filter((x) => x.rung === rung).sort((a, b) => first(a) - first(b) || byRungOrder(a, b));
    // Two lanes, taken in turn: the templates as written, and the dishes the kitchen opened from
    // them (one per template before any template's second), so testers rate both kinds.
    const originals = list.filter((x) => !x.meal.template);
    const byRoot = new Map();
    for (const x of list.filter((y) => y.meal.template)) byRoot.set(root(x), [...(byRoot.get(root(x)) ?? []), x]);
    const roots = [...byRoot.values()];
    const variants = [];
    for (let i = 0; variants.length < list.length - originals.length; i++) for (const lane of roots) if (lane[i]) variants.push(lane[i]);
    const q = [];
    for (let i = 0; q.length < list.length; i++) for (const lane of [originals, variants]) if (lane[i]) q.push(lane[i]);
    if (q.length) queues[rung] = q;
  }
  const out = [];
  while (out.length < max && Object.values(queues).some((q) => q.length)) {
    for (const rung of [1, 2, 3, 4]) if (queues[rung]?.length && out.length < max) out.push(queues[rung].shift());
  }
  return out;
}

const shortHow = (meal) => {
  const names = (meal.ingredients ?? []).map((i) => i.name ?? i.id ?? i.anyOf?.[0]).filter(Boolean);
  return names.slice(0, 5).join(', ').replace(/_/g, ' ');
};

/** Ids in `pool` that the `below` inventory can't make (its own catalogue, opened the same way). */
export function freshAt(pool, below, { kind = 'meal', verdicts = PIERRE_SEED, config = DEFAULT_CONFIG } = {}) {
  const r = rank({ inventory: below, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind }, catalogue: expandTemplates(CATALOGUE, below), verdicts, config });
  const have = new Set(r.ranked.filter((x) => !x.away).map((x) => x.meal.id));
  return new Set(pool.filter((x) => !have.has(x.meal.id)).map((x) => x.meal.id));
}

/** The persona kitchen one level below `kitchen` in `kitchens` (cumulative L1–L5), or null. */
export function levelBelow(kitchen, kitchens) {
  const n = Number(kitchen?.level);
  if (!Number.isFinite(n) || n <= 1) return null;
  return (kitchens ?? []).find((k) => Number(k?.level) === n - 1) ?? null;
}

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
export function buildRungQuiz({ kitchen, inventory, catalogue = null, verdicts = PIERRE_SEED, config = DEFAULT_CONFIG, prefer = null, deckMax = DECK_MAX, below = null }) {
  const id = kitchenId(kitchen);
  // 1.54.0: no catalogue given → the catalogue as this kitchen opens it (open-slot templates).
  catalogue ??= expandTemplates(CATALOGUE, inventory);
  const go = (kind) => rank({ inventory, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind }, catalogue, verdicts, config });
  let kind = 'meal';
  let r = go(kind);
  if (!r.ranked.length) r = go(kind = 'any');
  // 1.50.0 (pranjal, 23 Nov): rate only what this kitchen, as confirmed, can make. A thin
  // kitchen no longer pads with one-away dishes; the bonus round is the one dish that needs more.
  const pool = r.ranked;
  // Cookable dishes lead their rung, so White's "Harvey's pick" is always one you can make.
  const realFirst = (a, b) => (a.away ? 1 : 0) - (b.away ? 1 : 0) || byRungOrder(a, b);
  const byRung = {};
  let groups = [];
  // 1.55.0: `below` = the inventory of the persona level under this one (L1 has none). The
  // dishes it can't make are this level's own, and they get the deck's slots first.
  const fresh = below ? freshAt(pool, below, { kind, verdicts, config }) : null;
  const chosen = stratify(pool, { max: deckMax, prefer, fresh });
  for (const rung of [1, 2, 3, 4]) {
    const items = chosen.filter((x) => x.rung === rung).sort(realFirst);
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
    groups.splice(Math.min(i, j), 2, { rungs: [...a.rungs, ...b.rungs], items: [...a.items, ...b.items] });
  }
  const dishes = {};
  const rungs = groups.map((grp) => {
    grp.items.forEach((x) => {
      dishes[x.meal.id] = {
        id: x.meal.id, name: x.meal.name, rung: x.rung, how: x.away ? `Needs ${x.away} · ${shortHow(x.meal)}` : shortHow(x.meal), facts: effortFacts(x.raw),
        ...(x.away ? { away: x.away } : {}),
        // 1.54.0, additive: the template a dish was opened from and what filled its slot.
        ...(x.meal.template ? { template: x.meal.template } : {}),
        // 1.55.0, additive: true when the persona level below this one can't make the dish.
        ...(fresh?.has(x.meal.id) ? { fresh: true } : {}),
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
  // 1.42.0: the card stack, in Harvey's order (easiest rung first, cookable before one-away),
  // and a seeded shuffle for rating, so ratings aren't read off the order Harvey showed.
  const deck = Object.values(dishes).sort((a, b) => a.rung - b.rung || (a.away ? 1 : 0) - (b.away ? 1 : 0) || a.harveys.order - b.harveys.order || a.id.localeCompare(b.id)).map((d) => d.id);
  // 1.57.0: the stratified order, shuffled one round at a time (was a shuffle of the whole deck).
  const rateOrder = rateOrderOf(chosen, `${id}|rate`);
  const bonus = bonusPick({ r, kind, inventory, catalogue, verdicts, config, shown: new Set(deck) });
  return { id, kitchen, kind, catalogue, rungs, dishes, steps, usage, deck, rateOrder, cookable: deck.filter((d) => !dishes[d].away).length, total: r.ranked.length, bonus };
}

/**
 * 1.44.0 bonus: one dish this kitchen could make with one more thing (a food or a piece of kit).
 * The thing that unlocks the most dishes not already shown wins; its best dish is the one asked
 * about. null when nothing is one thing away.
 */
export function bonusPick({ r, kind, inventory, catalogue = CATALOGUE, verdicts = PIERRE_SEED, config = DEFAULT_CONFIG, shown = new Set() }) {
  const pool = oneAway({ r, kind, inventory, catalogue, verdicts, config }).filter((x) => !shown.has(x.meal.id) && x.pierre.tier !== 'veto');
  if (!pool.length) return null;
  const by = new Map();
  for (const x of pool) by.set(x.need, [...(by.get(x.need) ?? []), x]);
  const [need, list] = [...by.entries()].sort((a, b) => b[1].length - a[1].length || pool.indexOf(a[1][0]) - pool.indexOf(b[1][0]))[0];
  const x = list[0];
  return {
    id: x.meal.id, name: x.meal.name, rung: x.rung, how: shortHow(x.meal), away: x.away,
    need: { id: need, label: labelFor(need), kind: kindOf(need) ?? 'food' },
    unlocks: list.map((y) => ({ id: y.meal.id, name: y.meal.name })),
    protein: x.meal.macros?.protein ?? null, kcal: x.meal.macros?.kcal ?? null,
    harveys: { tier: x.pierre.tier, friction: round(x.friction), score: round(x.score) },
    raw: compactRaw(x.raw),
  };
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
    if (x) out.push({ ...x, away: describeMissing(f.missing)[0], need: id });
  }
  return out.sort((a, b) => TIER_ORDER[b.pierre.tier] - TIER_ORDER[a.pierre.tier] || b.score - a.score || a.meal.id.localeCompare(b.meal.id));
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);
function compactRaw(raw) {
  if (!raw) return null;
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, round(v)]));
}

const confirmOut = (c) => {
  const typed = (c.typed ?? []).map((t) => ({ text: String(t.text ?? '').slice(0, 60), id: t.id ?? null, how: t.how ?? null })).filter((t) => t.text).slice(0, 30);
  return {
    asked: [...(c.asked ?? [])], have: [...(c.have ?? [])], typed,
    unmatched: typed.filter((t) => !t.id).map((t) => t.text),
    burners: [1, 2, 3].includes(c.burners) ? c.burners : null,
    noStove: !!c.noStove,
    // 1.44.0: the tester confirms the list instead of being asked. removed = listed items they
    // unticked (not in their kitchen); listed = how many listed items they were shown.
    ...(c.removed ? { removed: c.removed.map((n) => String(n).slice(0, 60)).slice(0, 80), listed: c.listed ?? null } : {}),
    ms: c.ms ?? null,
  };
};

const cardsOut = (quiz, answers) => {
  const deck = quiz.deck ?? Object.keys(quiz.dishes);
  const why = new Set(WHY_NOT.map((w) => w.id));
  const cards = deck.filter((id) => answers.cards[id]).map((id) => {
    const a = answers.cards[id];
    return { id, yes: !!a.yes, why: !a.yes && why.has(a.why) ? a.why : null, ms: a.ms ?? null };
  });
  const d = answers.difficulty;
  const rated = d?.levels ? (quiz.rateOrder ?? deck).filter((id) => [1, 2, 3, 4, 5].includes(d.levels[id]?.level)) : [];
  return {
    flow: 'cards',
    cards,
    difficulty: d && !d.skipped ? { scale: DIFFICULTY.map((x) => x.label), ratings: rated.map((id) => ({ id, level: d.levels[id].level, ms: d.levels[id].ms ?? null })), stoppedEarly: rated.length < deck.length } : null,
  };
};

const starsOut = (quiz, answers) => {
  const deck = quiz.deck ?? Object.keys(quiz.dishes);
  const ok = (n) => ([1, 2, 3, 4, 5].includes(n) ? n : null);
  const cant = new Set(CANT.map((c) => c.id));
  const stars = deck.filter((id) => answers.stars[id]).map((id) => {
    const a = answers.stars[id];
    // 1.46.0: what's missing is a multi-pick; cant stays the first, cants holds them all.
    const cants = [...new Set(a.cants ?? (a.cant ? [a.cant] : []))].filter((c) => cant.has(c));
    // 1.57.0, additive: why = the one-tap reasons for a low taste rating (TASTE_WHY ids).
    const why = ok(a.taste) && a.taste <= 2 ? [...new Set(a.why ?? [])].filter((w) => TASTE_WHY.some((t) => t.id === w)) : [];
    return { id, effort: ok(a.effort), taste: ok(a.taste), cant: cants[0] ?? null, ...(cants.length ? { cants } : {}), ...(why.length ? { why } : {}), ms: a.ms ?? null };
  }).filter((x) => x.effort || x.taste || x.cant);
  const rated = stars.filter((x) => x.effort);
  return {
    flow: 'stars',
    // 1.48.0: the order the dishes were rated in (before, Harvey's easiest-first deck).
    order: quiz.rateOrder ?? deck,
    stars,
    // 1.57.0, additive: how many dishes the rater got through, of how many the kitchen opens.
    rated: stars.length, of: deck.length, ...(answers.done ? { done: true } : {}),
    // Effort stars on the old difficulty scale, so rungMarcoChoices and the reports read them as before.
    difficulty: rated.length ? { scale: DIFFICULTY.map((x) => x.label), from: 'effort stars, level = 6 - stars', ratings: rated.map((x) => ({ id: x.id, level: 6 - x.effort, ms: x.ms })), stoppedEarly: rated.length < deck.length } : null,
  };
};

export const WANT_STARS = ['No way', 'Unlikely', 'Maybe', 'Likely', 'Definitely'];
const bonusOut = (quiz, answers) => {
  const b = quiz.bonus;
  if (!b) return null;
  const ok = (n) => ([1, 2, 3, 4, 5].includes(n) ? n : null);
  const a = answers.stars?.[b.id] ?? {};
  const w = answers.bonusItem ?? {};
  return {
    id: b.id, name: b.name, rung: b.rung, need: b.need, unlocks: b.unlocks.map((u) => u.id), harveys: b.harveys, raw: b.raw,
    effort: ok(a.effort), taste: ok(a.taste), cant: CANT.some((c) => c.id === a.cant) ? a.cant : null,
    want: ok(w.want), have: !!w.have, ms: (a.ms ?? 0) + (w.ms ?? 0) || null,
  };
};

/**
 * Answers → the file a tester sends. answers: { marco: {rung: {ranking, ms, moved}},
 * pierre: {…same}, white: {rung: {picks, none, criteria, ms}} }.
 */
export function encodeRungResult(quiz, answers, { version, at, testerId, runNo = null, source = 'paste', tester = '', kitchenSource = null } = {}) {
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
    // 1.52.0, additive: 'sample' when the tester picked a sample kitchen on the bare site, 'link'
    // when a share link carried it in. Left out for a pasted list. The format stays harveys-rung-quiz/1.
    ...(['sample', 'link'].includes(kitchenSource) ? { kitchenSource } : {}),
    kitchen: { kitchen: quiz.kitchen.kitchen, diet: quiz.kitchen.diet ?? 'unknown', notes: quiz.kitchen.notes ?? '', ...(Number.isInteger(quiz.kitchen.level) ? { level: quiz.kitchen.level } : {}), items: (quiz.kitchen.items ?? []).map((i) => ({ name: i.name, category: i.category })) },
    moment: MOMENT.label, targets: TARGETS,
    directions: { marco: 'easiest first', pierre: 'tastiest first', white: 'tap order = preference' },
    // From 1.32.0 an unmoved sort was confirmed with a "Keep this order" tap, so it is a real answer.
    unmovedConfirmed: true,
    // 1.39.0: the quick check before Round 1: what Harvey asked about, and what the tester has.
    // The dishes below already count what they tapped; null: no check was shown.
    // 1.41.0: cookware is asked too; typed = "Anything else?" ({ text, id, how }: id null when
    // nothing in Harvey's list was close, and those are what the reports flag as new);
    // burners = how many things can cook at once (3 = 3 or more); noStove = the list had none.
    confirm: answers.confirm ? confirmOut(answers.confirm) : null,
    // 1.33.0: what the kitchen had that no shown dish used, and why: catalogue gaps across kitchens.
    ingredients: quiz.usage ? usageForResult(quiz.usage) : null,
    dishes: Object.fromEntries(Object.values(quiz.dishes).map((d) => [d.id, { name: d.name, rung: d.rung, harveys: d.harveys, raw: d.raw, ...(d.away ? { away: d.away } : {}), ...(d.template ? { template: d.template } : {}) }])),
    marco: sortRows('marco'),
    pierre: sortRows('pierre'),
    white: quiz.rungs.filter((g) => answers.white?.[g.rung]).map((g) => {
      const a = answers.white[g.rung];
      return { rung: g.rung, rungs: g.rungs ?? [g.rung], harveys: g.pick === undefined ? g.dishes[0] : g.pick, shown: g.shown.white, picks: a.none ? [] : a.picks, none: !!a.none, criteria: a.criteria ?? [], ms: a.ms ?? null };
    }),
    // 1.42.0 meal cards (flow 'cards'): marco/pierre/white stay empty. cards = the deck in the
    // order shown, yes/no and why not; difficulty = 1 (effortless) … 5 (too much tonight), in the
    // order rated, null when skipped. rungMarcoChoices turns ratings into pairs.
    // 1.43.0 recipe test (flow 'stars'): stars = per dish effort and taste 1-5 (5 = effortless,
    // delicious) and cant ('ingredients' | 'equipment'); difficulty is the effort stars as levels.
    // 1.46.0: cants = every reason ticked (one or both); a dish can't-made may still carry stars.
    ...(answers.stars ? starsOut(quiz, answers) : answers.cards ? cardsOut(quiz, answers) : {}),
    // 1.44.0 bonus: a dish one thing away (need), its effort and taste stars, and want = how
    // likely they'd get that thing, 1 (no way) … 5 (definitely); have = they already have it.
    bonus: bonusOut(quiz, answers),
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
  // 1.42.0: difficulty ratings. Every two dishes rated at different levels are one pair; ties say nothing.
  const rated = result.difficulty?.ratings ?? [];
  for (let i = 0; i < rated.length; i++) for (let j = i + 1; j < rated.length; j++) {
    if (rated[i].level === rated[j].level) continue;
    const [e, h] = rated[i].level < rated[j].level ? [rated[i], rated[j]] : [rated[j], rated[i]];
    const easier = result.dishes[e.id];
    const harder = result.dishes[h.id];
    if (!easier?.raw || !harder?.raw) continue;
    const xe = featureVector(easier.raw, PIERRE_VALUE[easier.harveys.tier] ?? 1);
    const xh = featureVector(harder.raw, PIERRE_VALUE[harder.harveys.tier] ?? 1);
    const flip = out.length % 2 === 1;
    out.push({ id: `d:${e.id}>${h.id}`, pick: flip ? 'b' : 'a', mood: 'okay', xa: flip ? xh : xe, xb: flip ? xe : xh });
  }
  return out;
}

/** How Harvey's did on one rung-quiz result. */
export function scoreRungResult(r) {
  // Harvey's easiest-first is the ladder: rung first (merged groups cross rungs), then friction.
  const easyOrder = (ids) => [...ids].sort((x, y) => r.dishes[x].rung - r.dishes[y].rung || r.dishes[x].harveys.friction - r.dishes[y].harveys.friction || x.localeCompare(y));
  const tasteOrder = (ids) => [...ids].sort((x, y) => TIER_ORDER[r.dishes[y].harveys.tier] - TIER_ORDER[r.dishes[x].harveys.tier] || r.dishes[x].rung - r.dishes[y].rung || r.dishes[x].harveys.order - r.dishes[y].harveys.order);
  const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
  const marco = (r.marco ?? []).map((m) => ({ rung: m.rung, tau: kendall(easyOrder(m.ranking), m.ranking), moved: m.moved }));
  const pierre = (r.pierre ?? []).map((p) => ({ rung: p.rung, tau: kendall(tasteOrder(p.ranking), p.ranking), moved: p.moved }));
  const white = (r.white ?? []).map((w) => ({ rung: w.rung, harveys: w.harveys, first: w.picks[0] ?? null, hit: w.picks[0] === w.harveys, inPicks: w.picks.includes(w.harveys), criteria: w.criteria }));
  // 1.42.0 cards: how many Harvey's suggestions they'd make, and whether Harvey's first card was one.
  const cardsIn = r.cards ?? [];
  const firstCookable = cardsIn.find((c) => !r.dishes[c.id]?.away);
  const whyNot = {};
  for (const c of cardsIn) if (!c.yes && c.why) whyNot[c.why] = (whyNot[c.why] ?? 0) + 1;
  const cards = { n: cardsIn.length, yes: cardsIn.filter((c) => c.yes).length, firstYes: firstCookable ? firstCookable.yes : null, whyNot };
  // Difficulty: of the pairs rated apart, how many Harvey's easiest-first puts the same way.
  const rated = r.difficulty?.ratings ?? [];
  let agree = 0;
  let pairsApart = 0;
  for (let i = 0; i < rated.length; i++) for (let j = i + 1; j < rated.length; j++) {
    if (rated[i].level === rated[j].level || !r.dishes[rated[i].id] || !r.dishes[rated[j].id]) continue;
    pairsApart++;
    const [e, h] = rated[i].level < rated[j].level ? [rated[i].id, rated[j].id] : [rated[j].id, rated[i].id];
    if (easyOrder([e, h])[0] === e) agree++;
  }
  const difficulty = { n: rated.length, pairs: pairsApart, agree: pairsApart ? round(agree / pairsApart) : null, skipped: !!r.cards && !r.difficulty };
  // 1.43.0 stars: taste pairs rated apart, and how often Pierre's tiers put them the same way.
  const st = r.stars ?? [];
  let tAgree = 0;
  let tPairs = 0;
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
    const a = st[i];
    const b = st[j];
    if (!a.taste || !b.taste || a.taste === b.taste || !r.dishes[a.id] || !r.dishes[b.id]) continue;
    const ta = TIER_ORDER[r.dishes[a.id].harveys.tier] ?? 0;
    const tb = TIER_ORDER[r.dishes[b.id].harveys.tier] ?? 0;
    if (ta === tb) continue;
    tPairs++;
    if ((a.taste > b.taste) === (ta > tb)) tAgree++;
  }
  const cant = {};
  for (const x of st) for (const c of x.cants ?? (x.cant ? [x.cant] : [])) cant[c] = (cant[c] ?? 0) + 1;
  const stars = { n: st.length, both: st.filter((x) => x.effort && x.taste).length, cant, tastePairs: tPairs, tasteAgree: tPairs ? round(tAgree / tPairs) : null };
  const criteria = {};
  for (const w of r.white ?? []) w.criteria.forEach((c, i) => { criteria[c] = (criteria[c] ?? 0) + (w.criteria.length - i); });
  return {
    kitchen: r.kitchen.kitchen, kitchenId: r.kitchenId, testerId: r.testerId, tester: r.tester ?? '', unmovedConfirmed: !!r.unmovedConfirmed,
    marco: { rungs: marco, tau: mean(marco.map((x) => x.tau)), pairs: rungMarcoChoices(r).length },
    pierre: { rungs: pierre, tau: mean(pierre.map((x) => x.tau)) },
    white: { rungs: white, hits: white.filter((x) => x.hit).length, inPicks: white.filter((x) => x.inPicks).length, n: white.length, criteria },
    flow: r.flow ?? 'rounds', cards, difficulty, stars,
    bonus: r.bonus ? { name: r.bonus.name, need: r.bonus.need?.label ?? null, effort: r.bonus.effort, taste: r.bonus.taste, want: r.bonus.want, have: r.bonus.have } : null,
  };
}

export { fitFrom };

// ── Batch checks (1.52.0, the 10-sample-kitchen batch) ──────────────────────
// Three open questions, read off every star-rated result: does 1.51.0's egg handling cost match
// what testers feel, are air-fryer dishes easier than Harvey thinks, and do the easiest dishes
// taste worse (easy vs tasty)? Effort stars: 5 = effortless. Harvey's order is rung, then friction:
// by default the one stored in each result (what testers were shown); `dishesFor` swaps in another
// (the script passes today's brain, so the egg line checks 1.51.0's egg handling, not the old one).
const dishOf = (id, catalogue) => catalogue.find((m) => m.id === id) ?? null;
const needs = (meal, id) => (meal?.ingredients ?? []).some((i) => !i.optional && (i.anyOf ?? [i.id]).every((x) => x === id));
/** An egg dish: eggs are a must (cracked or peeled). Off-catalogue dishes go by name. */
export const isEggDish = (id, name = '', catalogue = CATALOGUE) => { const m = dishOf(id, catalogue); return m ? needs(m, 'eggs') : /\begg/i.test(name); };
/** An air-fryer dish: the air fryer is on its kit list. */
export const isAirFryerDish = (id, name = '', catalogue = CATALOGUE) => { const m = dishOf(id, catalogue); return m ? (m.equipment ?? []).includes('air_fryer') : /air[- ]?fr/i.test(name); };

export function batchChecks(results, { catalogue = CATALOGUE, dishesFor = (r) => r.dishes } = {}) {
  const avg = (xs) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const eggs = { egg: { pairs: 0, agree: 0 }, plain: { pairs: 0, agree: 0 }, effort: [], otherEffort: [] };
  const air = { effort: [], otherEffort: [], pairs: 0, easierThanHarvey: 0 };
  const easy = { testers: [], lowTaste: 0 };
  for (const r of results) {
    if (!Array.isArray(r.stars) || !r.dishes) continue;
    const order = dishesFor(r) ?? {};
    const harveyRank = (id) => [order[id].rung ?? 9, order[id].harveys?.friction ?? 0, id];
    const easier = (x, y) => { const [a, b] = [harveyRank(x), harveyRank(y)]; return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]); };
    const rated = r.stars.filter((x) => r.dishes[x.id] && order[x.id]);
    const egg = (id) => isEggDish(id, r.dishes[id].name, catalogue);
    const af = (id) => isAirFryerDish(id, r.dishes[id].name, catalogue);
    for (const x of rated) if (x.effort) {
      (egg(x.id) ? eggs.effort : eggs.otherEffort).push(x.effort);
      (af(x.id) ? air.effort : air.otherEffort).push(x.effort);
    }
    const eff = rated.filter((x) => x.effort);
    for (let i = 0; i < eff.length; i++) for (let j = i + 1; j < eff.length; j++) {
      const [a, b] = [eff[i], eff[j]];
      if (a.effort === b.effort) continue;
      const [e, h] = a.effort > b.effort ? [a.id, b.id] : [b.id, a.id]; // e: the one rated easier
      const agree = easier(e, h) < 0;
      const side = egg(a.id) || egg(b.id) ? eggs.egg : eggs.plain;
      side.pairs++;
      if (agree) side.agree++;
      if (af(a.id) !== af(b.id)) {
        air.pairs++;
        if (af(e) && !agree) air.easierThanHarvey++;
      }
    }
    // Easy vs tasty: the tester's two lowest-friction dishes (Harvey's order) against the rest.
    const tasted = rated.filter((x) => x.taste).sort((x, y) => easier(x.id, y.id));
    if (tasted.length >= 3) {
      const low = avg(tasted.slice(0, 2).map((x) => x.taste));
      const rest = avg(tasted.slice(2).map((x) => x.taste));
      easy.testers.push({ tester: r.tester || r.testerId, easiest: tasted.slice(0, 2).map((x) => x.id), easiestTaste: low, restTaste: rest });
      if (low <= 3) easy.lowTaste++;
    }
  }
  const rate = (s) => ({ ...s, rate: s.pairs ? round(s.agree / s.pairs) : null });
  return {
    eggs: { egg: rate(eggs.egg), plain: rate(eggs.plain), meanEffort: avg(eggs.effort), n: eggs.effort.length, otherMeanEffort: avg(eggs.otherEffort) },
    airFryer: { meanEffort: avg(air.effort), n: air.effort.length, otherMeanEffort: avg(air.otherEffort), pairs: air.pairs, easierThanHarvey: air.easierThanHarvey },
    easyTasty: { ...easy, n: easy.testers.length },
  };
}

/**
 * Today's Harvey on a result's kitchen as the tester confirmed it (unticked items out, ticked and
 * typed ones in): every dish it can make → { rung, harveys: { friction } }, for batchChecks' dishesFor.
 * Every cookable dish counts, not just a deck, so dishes rated then stay comparable now.
 */
export function todayOrder(r, { cache = {}, catalogue = CATALOGUE, config = DEFAULT_CONFIG } = {}) {
  if (!Array.isArray(r.kitchen?.items)) return null;
  const gone = new Set((r.confirm?.removed ?? []).map((x) => String(x).toLowerCase().trim()));
  const kept = r.kitchen.items.filter((i) => !gone.has(String(i.name ?? i).toLowerCase().trim()));
  const ids = [...new Set([...(r.confirm?.have ?? []), ...(r.confirm?.typed ?? []).filter((t) => t.id).map((t) => t.id)])];
  const inventory = withConfirmed(kept, ids, { cache });
  const go = (kind) => rank({ inventory, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind }, catalogue, config });
  const ranked = [...go('meal').ranked, ...go('any').ranked];
  const out = {};
  for (const x of ranked) out[x.meal.id] ??= { rung: x.rung, harveys: { friction: round(x.friction) } };
  return out;
}

/** The three checks as the lines `kitchen-tests.mjs score` prints under "# Batch checks". */
export function batchCheckLines(b) {
  const f = (x) => (x == null ? '-' : x.toFixed(2));
  const st = (x) => (x == null ? '-' : `${x.toFixed(1)}★`);
  return [
    `Eggs:     effort pairs Harvey orders right, with an egg dish ${b.eggs.egg.agree}/${b.eggs.egg.pairs} (${f(b.eggs.egg.rate)}), without ${b.eggs.plain.agree}/${b.eggs.plain.pairs} (${f(b.eggs.plain.rate)}); egg dishes ${st(b.eggs.meanEffort)} effort over ${b.eggs.n} rating(s), others ${st(b.eggs.otherMeanEffort)}`,
    `Air fryer: ${st(b.airFryer.meanEffort)} effort over ${b.airFryer.n} rating(s), others ${st(b.airFryer.otherMeanEffort)}; rated easier than Harvey ranked it in ${b.airFryer.easierThanHarvey} of ${b.airFryer.pairs} air-fryer-vs-other pair(s)`,
    `Easy vs tasty: ${b.easyTasty.n ? b.easyTasty.testers.map((t) => `${t.tester} easiest two ${st(t.easiestTaste)} vs rest ${st(t.restTaste)}`).join('; ') : '-'}; ${b.easyTasty.lowTaste} of ${b.easyTasty.n} tester(s) rated their easiest two 3★ or less on taste`,
  ];
}

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
