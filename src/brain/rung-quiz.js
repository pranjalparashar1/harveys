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
/**
 * 1.49.0: most dishes a tester rates. PER_RUNG alone left Banana Singh (23 Nov) rating 8 of
 * 21 cookable dishes: 18 sat on rung 3, so the paneer dishes she unlocked never showed. Free
 * slots now go to the rest, dishes the tester's added items unlocked (`prefer`) first.
 */
export const DECK_MAX = 10;
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
export function buildRungQuiz({ kitchen, inventory, catalogue = CATALOGUE, verdicts = PIERRE_SEED, config = DEFAULT_CONFIG, prefer = null }) {
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
  // Top up to DECK_MAX from the cookable dishes the rung cap left out, added-item dishes first.
  const taken = new Set(groups.flatMap((g) => g.items.map((x) => x.meal.id)));
  const pref = (x) => (prefer?.has(x.meal.id) ? 0 : 1);
  const rest = pool.filter((x) => !x.away && !taken.has(x.meal.id)).sort((a, b) => pref(a) - pref(b) || byRungOrder(a, b));
  let size = taken.size;
  for (const x of rest) {
    if (size >= DECK_MAX) break;
    const grp = groups.find((g) => g.rungs.includes(x.rung));
    if (!grp) continue;
    grp.items.push(x);
    (byRung[x.rung] ??= []).push(x);
    size += 1;
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
  // 1.42.0: the card stack, in Harvey's order (easiest rung first, cookable before one-away),
  // and a seeded shuffle for rating, so ratings aren't read off the order Harvey showed.
  const deck = Object.values(dishes).sort((a, b) => a.rung - b.rung || (a.away ? 1 : 0) - (b.away ? 1 : 0) || a.harveys.order - b.harveys.order || a.id.localeCompare(b.id)).map((d) => d.id);
  const rateOrder = seededShuffle(deck, `${id}|rate`);
  const bonus = bonusPick({ r, kind, inventory, catalogue, verdicts, config, shown: new Set(deck) });
  return { id, kitchen, kind, rungs, dishes, steps, usage, deck, rateOrder, cookable: deck.filter((d) => !dishes[d].away).length, total: r.ranked.length, bonus };
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
    return { id, effort: ok(a.effort), taste: ok(a.taste), cant: cants[0] ?? null, ...(cants.length ? { cants } : {}), ms: a.ms ?? null };
  }).filter((x) => x.effort || x.taste || x.cant);
  const rated = stars.filter((x) => x.effort);
  return {
    flow: 'stars',
    // 1.48.0: the order the dishes were rated in (before, Harvey's easiest-first deck).
    order: quiz.rateOrder ?? deck,
    stars,
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
    // 1.39.0: the quick check before Round 1: what Harvey asked about, and what the tester has.
    // The dishes below already count what they tapped; null: no check was shown.
    // 1.41.0: cookware is asked too; typed = "Anything else?" ({ text, id, how }: id null when
    // nothing in Harvey's list was close, and those are what the reports flag as new);
    // burners = how many things can cook at once (3 = 3 or more); noStove = the list had none.
    confirm: answers.confirm ? confirmOut(answers.confirm) : null,
    // 1.33.0: what the kitchen had that no shown dish used, and why: catalogue gaps across kitchens.
    ingredients: quiz.usage ? usageForResult(quiz.usage) : null,
    dishes: Object.fromEntries(Object.values(quiz.dishes).map((d) => [d.id, { name: d.name, rung: d.rung, harveys: d.harveys, raw: d.raw, ...(d.away ? { away: d.away } : {}) }])),
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
