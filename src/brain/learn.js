// Learning Marco and Pierre from pick-two choices (1.4.0).
//
//   Marco  = the whole brain: is this dish worth the effort tonight?
//   Pierre = the taste layer inside it: does the result deserve to be eaten?
//            MPW is not austere: a good result with maximal simplicity.
//
// The user is shown two dishes and taps the one they'd cook tonight (or
// neither), and can give each dish a Pierre verdict: pass, meh or fail.
// From those taps this file fits:
//
//   1. Pierre is no longer fitted here: its tier comes from pierreTier()
//      (ingredients.js), the same engine the live ranker uses (Step 5B).
//   2. Marco: a Bradley–Terry (pairwise logistic) model,
//        P(pick A over B) = σ(u_A − u_B),   u = θ · x
//      where x = protein, Pierre and the friction features below. θ starts at a
//      prior and moves with every tap (MAP with an L2 pull to the prior, so a
//      dozen taps can't swing it wildly).
//   3. λ per mood: how much heavier friction feels when tired than when fresh.
//
// Friction features fix three flaws of the 1.3 ranker: the stove is no longer
// counted as a tool on top of the pan, peeling (garlic, onion) is separated
// from easy cuts (paneer cubes, tomato), and pre-prep (soaking, marinating) is
// its own variable.
//
// Pure: no DOM, no network, no clock, no Math.random (callers pass rng).

import { FOODS } from './vocabulary.js';

// ── Features ────────────────────────────────────────────────────────────────

/** Things that are a real chore to prepare: skins, roots, layers. */
export const PEEL = new Set(['garlic', 'onion', 'ginger']);

/** Heat sources that only exist to heat a vessel: not a tool of their own. */
const HEAT_SOURCES = new Set(['stovetop', 'induction', 'gas_stove']);
const VESSELS = new Set(['pot', 'pan', 'saucepan', 'frying_pan', 'tawa', 'kadai', 'pressure_cooker']);
const EATING_WARE = new Set(['plate', 'spoon', 'fork', 'mug']);

/** Never shown: the user eats vegetarian + eggs (19 Nov 2026). */
export const NOT_IN_DIET = new Set(['chicken', 'tuna']);

export function inDiet(dish) {
  return !(dish.ingredients ?? []).some((i) => !i.optional && (i.anyOf ?? [i.id]).every((id) => NOT_IN_DIET.has(id)));
}

/**
 * Feature definitions. `scale` turns raw units into roughly 0..1 for a typical
 * dish; `prior` is θ before any tap (in scaled units). Protein and Pierre are
 * payoff (positive); everything else is friction (negative).
 */
export const FEATURES = [
  { key: 'protein', label: 'protein', unit: 'g', scale: 30, prior: 1.0, payoff: true },
  { key: 'pierre', label: 'Pierre (taste)', unit: '', scale: 1, prior: 1.0, payoff: true },
  { key: 'tools', label: 'tools', unit: 'tool', scale: 4, prior: -0.4 },
  { key: 'handsOn', label: 'hands-on minutes', unit: 'min', scale: 10, prior: -0.6 },
  { key: 'waiting', label: 'waiting minutes', unit: 'min', scale: 15, prior: -0.15 },
  { key: 'prePrep', label: 'pre-prep (soak, marinate)', unit: 'step', scale: 1, prior: -0.5 },
  { key: 'peels', label: 'things to peel', unit: 'thing', scale: 1, prior: -0.5 },
  { key: 'cuts', label: 'things to cut', unit: 'thing', scale: 2, prior: -0.25 },
  { key: 'steps', label: 'steps', unit: 'step', scale: 5, prior: -0.2 },
  { key: 'attention', label: 'attention', unit: 'level', scale: 3, prior: -0.3 },
  { key: 'cleanup', label: 'washing up', unit: 'dish', scale: 5, prior: -0.4 },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);

/**
 * Pre-prep on a log scale: 15 min soak = 1, 1 h = 2.3, overnight (8 h) = 5.
 * Waiting you plan for hurts less per minute the longer it is, but never zero.
 */
export function prePrepUnits(minutes) {
  return minutes > 0 ? Math.log2(1 + minutes / 15) : 0;
}

/**
 * Raw friction and payoff for one dish, in natural units (except pierre,
 * which the caller fills in). A dish may carry `counts` (the user's own dishes
 * say "2 things to peel" instead of listing ingredients); counts win.
 */
// 1.51.0: cracking or peeling eggs costs more than its minutes. Both testers who rated effort
// (Banana Singh 1.48.0, Purujeet 1.50.0) put boiled eggs and 6 of 7 egg dishes at "Some effort",
// a level above what Harvey's placed them; 2 extra hands-on minutes per egg dish took friction's
// agreement with their ratings from 41/55 pairs to 45/55. Waiting and kit are unchanged.
export const EGG_HANDLING_MINUTES = 2;
const handlesEggs = (dish) => (dish.ingredients ?? []).some((i) => !i.optional && i.id === 'eggs');

export function rawFeatures(dish) {
  const c = dish.counts ?? {};
  const core = (dish.ingredients ?? []).filter((i) => !i.optional);
  const kit = (dish.equipment ?? []).filter((id) => !HEAT_SOURCES.has(id) || !(dish.equipment ?? []).some((e) => VESSELS.has(e)));
  const smallKit = (dish.utensils ?? []).filter((u) => !EATING_WARE.has(u));
  const steps = dish.steps ?? [];
  const sum = (k) => steps.reduce((acc, s) => acc + (Number(s[k]) || 0), 0);
  const peelCut = core.filter((i) => i.prep === 'peel_chop' || i.prep === 'cut' || i.prep === 'peel');
  const isPeel = (i) => i.prep === 'peel' || PEEL.has(i.id);
  return {
    protein: Number(c.protein ?? dish.macros?.protein) || 0,
    tools: c.tools ?? kit.length + smallKit.length,
    handsOn: c.handsOn ?? sum('active') + (handlesEggs(dish) ? EGG_HANDLING_MINUTES : 0),
    waiting: c.waiting ?? sum('passive'),
    prePrepMinutes: c.prePrepMinutes ?? dish.prePrep?.minutes ?? 0,
    peels: c.peels ?? peelCut.filter(isPeel).length,
    cuts: c.cuts ?? peelCut.filter((i) => !isPeel(i)).length,
    steps: c.steps ?? steps.length,
    attention: c.attention ?? dish.attention ?? 1,
    cleanup: c.cleanup ?? (dish.cleanup ? dish.cleanup.dishes + 1.5 * (dish.cleanup.greasy ?? 0) : 1),
  };
}

/** Scaled feature vector, in FEATURES order. `pierre` is 0 (fail) … 1 (pass). */
export function featureVector(raw, pierre) {
  const values = { ...raw, pierre: (pierre - 0.5) * 2, prePrep: prePrepUnits(raw.prePrepMinutes ?? 0) };
  return FEATURES.map((f) => (Number(values[f.key]) || 0) / f.scale);
}

// ── How a dish is cooked ────────────────────────────────────────────────────

const METHOD_WORDS = [
  ['microwave', /microwave/i],
  ['air-fry', /air[- ]?fr/i],
  ['boil', /\bboil|\bsimmer/i],
  ['pressure-cook', /pressure|whistle/i],
  ['pan-fry', /\bfry|\bsaut|\btoss .* in (oil|butter|ghee)|\btawa|\bpan\b|\bskillet/i],
  ['toast', /\btoast|\bgrill|sandwich maker/i],
];
const EQUIPMENT_METHOD = {
  microwave: 'microwave', air_fryer: 'air-fry', pressure_cooker: 'pressure-cook',
  pan: 'pan-fry', frying_pan: 'pan-fry', tawa: 'pan-fry', kadai: 'pan-fry',
  sandwich_maker: 'toast', toaster: 'toast', oven: 'bake', pot: 'boil', saucepan: 'boil',
};

/** How the dish is cooked: from its kit, its steps and anything the user ticked. */
export function methodsOf(dish) {
  const found = new Set(dish.methods ?? []);
  for (const e of dish.equipment ?? []) if (EQUIPMENT_METHOD[e]) found.add(EQUIPMENT_METHOD[e]);
  const text = (dish.steps ?? []).map((s) => s.text ?? '').join(' ') + ' ' + (dish.how ?? '');
  for (const [m, re] of METHOD_WORDS) if (re.test(text)) found.add(m);
  if (found.size === 0) found.add('no-cook');
  return [...found].sort();
}

/** The ingredients the dish is "about": proteins, dairy, grains and pulses. */
export function starsOf(dish) {
  if (dish.stars?.length) return [...new Set(dish.stars)].sort();
  const groups = new Set(['protein', 'dairy', 'grain', 'bread']);
  const ids = (dish.ingredients ?? [])
    .filter((i) => !i.optional)
    .map((i) => i.id ?? i.anyOf?.[0])
    .filter((id) => id && groups.has(FOODS[id]?.group));
  return [...new Set(ids)].sort();
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// ── Marco: pairwise choices → weights ──────────────────────────────────────

/** Solves A x = b for a small dense system (Gaussian elimination with pivoting). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * MAP logistic regression by Newton's method.
 * rows: { x: number[], y: 0|1, w?: weight }. prior: number[] (θ0). alpha: pull to prior.
 */
export function fitLogistic(rows, prior, { alpha = 1, iterations = 30 } = {}) {
  const d = prior.length;
  let theta = [...prior];
  for (let it = 0; it < iterations; it++) {
    const grad = theta.map((t, j) => alpha * (t - prior[j]));
    const H = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? alpha : 0)));
    for (const r of rows) {
      const wt = r.w ?? 1;
      const p = sigmoid(r.x.reduce((acc, v, j) => acc + v * theta[j], 0));
      const s = wt * p * (1 - p);
      for (let i = 0; i < d; i++) {
        grad[i] += wt * (p - r.y) * r.x[i];
        if (r.x[i] === 0) continue;
        for (let j = 0; j < d; j++) H[i][j] += s * r.x[i] * r.x[j];
      }
    }
    const step = solve(H, grad);
    theta = theta.map((t, j) => t - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return theta;
}

const FRICTION_MASK = FEATURES.map((f) => !f.payoff);

/** Utility of a dish: payoff − λ × friction, all in θ's scaled units. */
export function utility(theta, x, lambda = 1, outside = 0) {
  return x.reduce((acc, v, j) => acc + v * theta[j] * (FRICTION_MASK[j] ? lambda : 1), 0) - outside;
}

/** Turns stored choices into logistic rows, given each dish's vector and the moods' λ. */
function choiceRows(choices, lambdas) {
  const rows = [];
  // The last column is the "outside option": would you cook it at all tonight?
  const withOutside = (x, lam, sign) => [...x.map((v, j) => sign * v * (FRICTION_MASK[j] ? lam : 1)), -sign];
  for (const c of choices) {
    const lam = lambdas[c.mood] ?? 1;
    if (c.pick === 'neither') {
      rows.push({ x: withOutside(c.xa, lam, 1), y: 0 });
      rows.push({ x: withOutside(c.xb, lam, 1), y: 0 });
      continue;
    }
    if (c.pick === 'either') {
      // Equivalent: either is as good as the other (a 50/50 label), and you'd cook either.
      rows.push({ x: [...c.xa.map((v, j) => (v - c.xb[j]) * (FRICTION_MASK[j] ? lam : 1)), 0], y: 0.5 });
      rows.push({ x: withOutside(c.xa, lam, 1), y: 1, w: 0.25 });
      rows.push({ x: withOutside(c.xb, lam, 1), y: 1, w: 0.25 });
      continue;
    }
    const [win, lose] = c.pick === 'a' ? [c.xa, c.xb] : [c.xb, c.xa];
    rows.push({ x: [...win.map((v, j) => (v - lose[j]) * (FRICTION_MASK[j] ? lam : 1)), 0], y: 1 });
    rows.push({ x: withOutside(win, lam, 1), y: 1, w: 0.5 }); // picking it = would cook it, softly
  }
  return rows;
}

/** Utility gap under which Marco calls two dishes equivalent (P(pick A) within 0.45–0.55). */
export const EITHER_GAP = 0.2;

function predictPick(theta, outside, c, lam) {
  const ua = utility(theta, c.xa, lam);
  const ub = utility(theta, c.xb, lam);
  if (Math.max(ua, ub) < outside) return 'neither';
  if (c.pick === 'either' && Math.abs(ua - ub) < EITHER_GAP) return 'either';
  return ua >= ub ? 'a' : 'b';
}

/**
 * Fits Marco's weights from choices.
 * @param {Array<{xa: number[], xb: number[], pick: 'a'|'b'|'either'|'neither', mood?: string}>} choices
 *        xa/xb are featureVector()s, Pierre already filled in.
 * @param {{prior?: number[]}} [opts] prior: θ to start from and pull toward (default FEATURES priors).
 * @returns {{theta, outside, lambdas, hits, looHits, priorHits, n}}
 */
export function fitMarco(choices, { alpha = 2, moods = ['fresh', 'okay', 'tired'], minPerMood = 4, prior: start } = {}) {
  // `start` (FEATURES order) replaces the priors, e.g. the weights the app runs on now.
  const prior = [...(start ?? FEATURES.map((f) => f.prior)), 0];
  const lambdas = Object.fromEntries(moods.map((m) => [m, 1]));
  const fit = (cs, lams) => fitLogistic(choiceRows(cs, lams), prior, { alpha });
  let all = fit(choices, lambdas);

  // λ per mood ("okay" is the reference, 1): a coarse search, two passes.
  const grid = [0.4, 0.55, 0.7, 0.85, 1, 1.2, 1.45, 1.75, 2.1, 2.5];
  const loss = (lams) => {
    const th = fit(choices, lams);
    return choiceRows(choices, lams).reduce((acc, r) => {
      const p = sigmoid(r.x.reduce((s, v, j) => s + v * th[j], 0));
      return acc - (r.w ?? 1) * Math.log(r.y ? Math.max(p, 1e-9) : Math.max(1 - p, 1e-9));
    }, 0);
  };
  const tunable = moods.filter((m) => m !== 'okay' && choices.filter((c) => c.mood === m).length >= minPerMood);
  if (tunable.length && choices.some((c) => c.mood === 'okay')) {
    for (let pass = 0; pass < 2; pass++) {
      for (const m of tunable) {
        let best = lambdas[m];
        let bestLoss = Infinity;
        for (const g of grid) {
          const l = loss({ ...lambdas, [m]: g });
          if (l < bestLoss) [best, bestLoss] = [g, l];
        }
        lambdas[m] = best;
      }
    }
    all = fit(choices, lambdas);
  }

  const theta = all.slice(0, -1);
  const outside = all.at(-1);
  const score = (th, out, cs) => cs.filter((c) => predictPick(th, out, c, lambdas[c.mood] ?? 1) === c.pick).length;
  const hits = score(theta, outside, choices);
  const priorHits = score(prior.slice(0, -1), 0, choices);
  // Leave-one-out: would Marco have predicted each tap without seeing it?
  let looHits = null;
  if (choices.length >= 3 && choices.length <= 150) {
    looHits = 0;
    for (let i = 0; i < choices.length; i++) {
      const rest = choices.filter((_, k) => k !== i);
      const th = fit(rest, lambdas);
      if (predictPick(th.slice(0, -1), th.at(-1), choices[i], lambdas[choices[i].mood] ?? 1) === choices[i].pick) looHits++;
    }
  }
  return { theta, outside, lambdas, hits, looHits, priorHits, n: choices.length };
}

/**
 * Weights in plain words: how many grams of protein each unit of friction is
 * worth to you. "One thing to peel ≈ 7 g protein."
 */
export function explainWeights(theta) {
  const perGram = theta[0] / FEATURES[0].scale; // utility per gram of protein
  return FEATURES.map((f, j) => {
    const perUnit = theta[j] / f.scale;
    return {
      key: f.key, label: f.label, unit: f.unit, theta: theta[j], prior: f.prior, payoff: !!f.payoff,
      // For pre-prep: the cost of the first 15-minute soak (1 unit on the log scale).
      gramsPerUnit: perGram > 0 ? -perUnit / perGram : null,
      moved: theta[j] - f.prior,
    };
  });
}

/**
 * The fitted Marco weights, ready for src/brain/config.js (PR 5C). Friction θ is scaled so
 * protein stays at its prior (1 per 30 g), the unit the live ranker's priors are in.
 */
export function fittedWeightsPayload(fit, choices = []) {
  const proteinPrior = FEATURES.find((f) => f.key === 'protein').prior;
  const k = fit.theta[0] > 0 ? proteinPrior / fit.theta[0] : 1;
  const frictionTheta = Object.fromEntries(FEATURES.map((f, j) => [f, fit.theta[j]]).filter(([f]) => !f.payoff).map(([f, t]) => [f.key, +(t * k).toFixed(3)]));
  return {
    taps: fit.n, looHits: fit.looHits, hits: fit.hits, priorHits: fit.priorHits, baseline: '7 PM after work, low energy',
    theta: Object.fromEntries(FEATURES.map((f, j) => [f.key, +fit.theta[j].toFixed(3)])),
    frictionTheta,
    explained: explainWeights(fit.theta).filter((w) => w.key !== 'protein').map((w) => ({ key: w.key, gramsPerUnit: w.gramsPerUnit == null ? null : +w.gramsPerUnit.toFixed(2) })),
    choices,
  };
}

// ── Picking the next pair ───────────────────────────────────────────────────

/**
 * Picks the pair that teaches Marco the most: close in predicted utility
 * (a hard call), not shown together before, and favouring dishes seen least.
 * Step 5B: when items carry `rung`, pairs stay within `maxRungGap` rungs of each
 * other (same rung preferred: the real trade-offs live there; the ladder already
 * separates rung 1 from rung 4). Any pair is a fallback only if none qualifies.
 * @param {Array<{id: string, x: number[], unjudged?: boolean, rung?: number}>} pool
 * @param {{theta: number[], seenPairs: Set<string>, shown: Map<string, number>, rng: () => number, last?: string[], maxRungGap?: number}} opts
 */
export function nextPair(pool, { theta, seenPairs = new Set(), shown = new Map(), rng, last = [], tries = 60, maxRungGap = 1 }) {
  if (pool.length < 2) return null;
  const gapOf = (a, b) => (a.rung == null || b.rung == null ? 0 : Math.abs(a.rung - b.rung));
  const candidates = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) if (gapOf(pool[i], pool[j]) <= maxRungGap) candidates.push([pool[i], pool[j]]);
  let best = null;
  for (let t = 0; t < tries; t++) {
    let a;
    let b;
    if (candidates.length) {
      [a, b] = candidates[Math.floor(rng() * candidates.length)];
    } else {
      const i = Math.floor(rng() * pool.length);
      let j = Math.floor(rng() * (pool.length - 1));
      if (j >= i) j++;
      [a, b] = [pool[i], pool[j]];
    }
    const key = [a.id, b.id].sort().join('|');
    const gap = Math.abs(utility(theta, a.x) - utility(theta, b.x));
    const novelty = 1 / (1 + (shown.get(a.id) ?? 0)) + 1 / (1 + (shown.get(b.id) ?? 0));
    const sameRung = a.rung != null && a.rung === b.rung ? 0.5 : 0;
    const score = -gap + 0.8 * novelty + sameRung + (a.unjudged ? 0.3 : 0) + (b.unjudged ? 0.3 : 0)
      - (seenPairs.has(key) ? 2 : 0) - (last.includes(a.id) || last.includes(b.id) ? 1.5 : 0) + 0.15 * rng();
    if (!best || score > best.score) best = { a, b, score };
  }
  return rng() < 0.5 ? [best.a, best.b] : [best.b, best.a];
}

/** Deterministic PRNG for tests and reproducible sessions. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
