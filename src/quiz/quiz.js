// Marco's quiz engine, after Kiron's: a quiz is a JSON file, played in short
// rounds, one screen at a time, and progress is saved after every screen.
// Unlike Kiron there is no right answer, so there are no streaks and no timer.
// Each food is rated in three steps (texture, taste, centre), every tap
// toggles, and Back steps to the previous screen, into the previous food too.
// Any food can be removed from the list (1.7.0): it's sent as "remove" and the
// ingest sets it aside. Pure logic only (no DOM), so it is tested in Node.

export const STEPS = ['texture', 'taste', 'centre'];
export const HEADER = '#harveys pierre-trainer v3';
// Pierre-tutor (1.8.0) rates a food cooked one way ("paneer@pan_fried") with the
// same engine: texture, taste, then Pierre's verdict instead of the centre.
export const TUTOR_HEADER = '#harveys pierre-tutor v1';
export const stepsOf = (quiz) => quiz?.steps ?? STEPS;
const headerOf = (quiz) => (quiz?.id === 'pierre-tutor' ? TUTOR_HEADER : HEADER);
// The last step is a pick the food can't go on without: its centre, or its verdict.
const PICKS = { centre: 'centre', verdict: 'verdict' };

/** Checks a quiz file and fills in defaults. Throws with every problem at once. */
export function validateQuiz(q) {
  const errs = [];
  if (q?.format !== 'marco-quiz') errs.push('format must be "marco-quiz"');
  const steps = stepsOf(q);
  for (const key of ['textures', 'tastes', 'foods', ...steps.filter((st) => PICKS[st])]) if (!Array.isArray(q?.[key]) || !q[key].length) errs.push(`${key} must be a non-empty list`);
  if (errs.length) throw new Error(errs.join('; '));
  const ids = new Set();
  for (const f of q.foods) {
    if (!/^[a-z][a-z0-9_]*(@[a-z][a-z0-9_]*)?$/.test(f.id ?? '')) errs.push(`bad food id "${f.id}"`);
    if (ids.has(f.id)) errs.push(`food "${f.id}" is listed twice`);
    ids.add(f.id);
    if (!f.name) errs.push(`food "${f.id}" has no name`);
  }
  if (q.levels?.length !== 4) errs.push('levels must be the four words for 0–3');
  if (errs.length) throw new Error(errs.join('; '));
  return { round: 7, ...q };
}

export const blankState = () => ({ answers: {}, round: null, sent: {} });
export const blankDraft = (quiz) => ({
  texture: Object.fromEntries(quiz.textures.map((t) => [t.id, 0])),
  taste: Object.fromEntries(quiz.tastes.map((t) => [t.id, 0])),
  centre: null,
  verdict: null, // Pierre-tutor: 2 pass, 1 meh, 0 fail
  rated: true,  // rate its texture, taste and centre
  prep: false,  // part of prep, needs further processing (soaked poha, whey)
  removed: false, // take it off the list: not for now (too much work, never cooked it)
});
// A food is rated, part of prep, or both (paneer). An answer has ratings when it has a centre.
export const isRated = (a) => a?.centre != null || a?.verdict != null;
export const isRemoved = (a) => !!a?.removed;

/** Foods not yet rated, the user's own kitchen (or everyday foods) first, each group shuffled. */
export function queue(quiz, state, rng = Math.random) {
  const left = quiz.foods.filter((f) => !state.answers[f.id]);
  const first = (f) => f.kitchen || f.everyday;
  return [...shuffle(left.filter(first), rng), ...shuffle(left.filter((f) => !first(f)), rng)].map((f) => f.id);
}

/** Starts the next round of up to `quiz.round` unrated foods. Null when all are rated. */
export function startRound(quiz, state, rng = Math.random) {
  const ids = queue(quiz, state, rng).slice(0, quiz.round);
  if (!ids.length) return { ...state, round: null };
  return { ...state, round: { ids, i: 0, step: 0, draft: blankDraft(quiz) } };
}

// ── Taps: each one toggles ──────────────────────────────────────────────────
/** Texture level 0–3. Tapping the level that's already on turns it back to none. */
export function tapTexture(draft, key, level) {
  const now = draft.texture[key] === level ? 0 : level;
  return { ...draft, texture: { ...draft.texture, [key]: now } };
}
/** Taste level 0–3, like texture (1.6.0: cheese is more fat than paneer). Same level again turns it back to none. */
export function tapTaste(draft, key, level) {
  const now = draft.taste[key] === level ? 0 : level;
  return { ...draft, taste: { ...draft.taste, [key]: now } };
}

/**
 * Answers saved before 1.6.0 marked a taste as present (1) with no level. They read as
 * Medium (2), and are flagged so the ingest knows the level was assumed.
 */
export function upgradeAnswer(a) {
  if (!a || a.v >= 2 || !isRated(a)) return a;
  const taste = Object.fromEntries(Object.entries(a.taste ?? {}).map(([k, v]) => [k, v ? 2 : 0]));
  return { ...a, taste, v: 2, tasteAssumed: true };
}
export function tapCentre(draft, value) {
  return { ...draft, centre: draft.centre === value ? null : value };
}
/** Pierre's verdict on a food cooked one way. Tap again to clear. */
export function tapVerdict(draft, value) {
  return { ...draft, verdict: draft.verdict === value ? null : value };
}

/** "Part of prep, needs further processing": flagged for Pierre-tutor, with or without ratings. */
export function tapPrep(draft) {
  return { ...draft, prep: !draft.prep };
}
/** "Rate it": off for a food that is only prep (soaked poha), which then skips the ratings. */
export function tapRated(draft) {
  return { ...draft, rated: !draft.rated };
}

/** "Remove from list": the food is set aside, whatever else was tapped. Tap again to undo. */
export function tapRemove(draft) {
  return { ...draft, removed: !draft.removed };
}

/** A food needs at least one of the two, or to be removed. Texture and taste can be all-none; a rated food needs its pick (centre, or verdict). */
export const canAdvance = (step, draft, steps = STEPS) => {
  if (draft.removed) return true;
  if (!draft.rated) return draft.prep;
  const pick = PICKS[steps[step]];
  return !pick || draft[pick] != null;
};

/** Next step, or the next food (saving this one), or the end of the round. */
export function advance(quiz, state, now = new Date()) {
  const r = state.round;
  const steps = stepsOf(quiz);
  if (!r || r.i >= r.ids.length || !canAdvance(r.step, r.draft, steps)) return state;
  const d = r.draft;
  if (!d.removed && d.rated && r.step < steps.length - 1) return { ...state, round: { ...r, step: r.step + 1 } };
  const picks = Object.fromEntries(steps.filter((st) => PICKS[st]).map((st) => [st, d[st]]));
  const answer = d.removed ? { removed: true } : d.rated
    ? { texture: d.texture, taste: d.taste, ...picks, v: 2, ...(d.prep ? { prep: true } : {}) }
    : { prep: true };
  const answers = { ...state.answers, [r.ids[r.i]]: { ...answer, at: now.toISOString() } };
  return { ...state, answers, round: { ...r, i: r.i + 1, step: 0, draft: blankDraft(quiz) } };
}

/** The previous screen: the step before, or the last step of the previous food, with its answer back in the draft. */
export function back(quiz, state) {
  const r = state.round;
  if (!r) return state;
  if (r.i < r.ids.length && r.step > 0 && r.draft.rated && !r.draft.removed) return { ...state, round: { ...r, step: r.step - 1 } };
  if (r.i === 0) return state;
  const i = r.i - 1;
  const a = state.answers[r.ids[i]];
  const blank = blankDraft(quiz);
  const rated = !a || isRated(a);
  const draft = !a ? blank : isRemoved(a) ? { ...blank, removed: true } : {
    texture: { ...blank.texture, ...a.texture }, taste: { ...blank.taste, ...a.taste }, centre: a.centre ?? null, verdict: a.verdict ?? null, rated, prep: !!a.prep,
  };
  return { ...state, round: { ...r, i, step: rated && !draft.removed ? stepsOf(quiz).length - 1 : 0, draft } };
}
export const canGoBack = (state) => !!state.round && (state.round.i > 0 || (state.round.step > 0 && state.round.draft.rated && !state.round.draft.removed));

export const roundOver = (state) => !state.round || state.round.i >= state.round.ids.length;
export const unsent = (state) => Object.keys(state.answers).filter((id) => !state.sent[id] || state.sent[id] < state.answers[id].at);
export const markSent = (state, ids, now = new Date()) => ({ ...state, sent: { ...state.sent, ...Object.fromEntries(ids.map((id) => [id, now.toISOString()])) } });

// ── "Send to Harvey's": a plain-text payload ────────────────────────────────
// One food per line, readable by a person and parsed by scripts/ingest-pierre.mjs:
//   paneer | t 0.3.2.1.0 | s 0.0.2.0.0.1.0 | c 4 | 2026-11-19T11:30:00.000Z
// t = crisp.creamy.chewy.juicy.flaky (0–3), s = salt.sugar.fat.acid.heat.canvas.fresh
// (0–3; the orders are in the export's "textures" and "tastes" lines), c = centre 1–5.
// "| assumed" marks a pre-1.6 answer whose taste levels were guessed as Medium.
// "Part of prep" adds "| prep" (paneer: rated and prep). A food that is only prep
// has no ratings:
//   paneer | t 0.3.2.1.0 | s fat | c 4 | prep | 2026-11-19T11:30:00.000Z
//   poha | prep | 2026-11-19T11:30:00.000Z
// A removed food (v3) is set aside by the ingest:
//   okra | remove | 2026-11-19T11:30:00.000Z
export function encodePayload(quiz, answers, ids = Object.keys(answers)) {
  const tex = quiz.textures.map((t) => t.id);
  const tas = quiz.tastes.map((t) => t.id);
  // Times to the minute: enough for "newer wins", and it keeps a whole quiz inside one issue URL.
  const minute = (at) => (typeof at === 'string' && at.length > 17 ? `${at.slice(0, 16)}Z` : at);
  const lines = ids.filter((id) => answers[id]).map((id) => {
    const a = { ...answers[id], at: minute(answers[id].at) };
    if (isRemoved(a)) return `${id} | remove | ${a.at}`;
    if (!isRated(a)) return `${id} | prep | ${a.at}`;
    // Pierre-tutor: v = verdict (2 pass, 1 meh, 0 fail) in place of the centre.
    if (a.verdict != null) return `${id} | t ${tex.map((k) => a.texture[k] ?? 0).join('.')} | s ${tas.map((k) => a.taste[k] ?? 0).join('.')} | v ${a.verdict} | ${a.at}`;
    return `${id} | t ${tex.map((k) => a.texture[k] ?? 0).join('.')} | s ${tas.map((k) => a.taste[k] ?? 0).join('.')} | c ${a.centre}${a.prep ? ' | prep' : ''}${a.tasteAssumed ? ' | assumed' : ''} | ${a.at}`;
  });
  return [headerOf(quiz), `textures ${tex.join('.')}`, `tastes ${tas.join('.')}`, ...lines].join('\n');
}

export function decodePayload(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim());
  if (!lines.some((l) => /^#(marco|harveys) pierre-(trainer|tutor)/.test(l))) throw new Error('not a Pierre-trainer export');
  const texLine = lines.find((l) => l.startsWith('textures '));
  const tex = texLine ? texLine.slice(9).trim().split('.') : ['crisp', 'creamy', 'chewy', 'juicy', 'flaky'];
  const tasLine = lines.find((l) => l.startsWith('tastes '));
  const tas = tasLine ? tasLine.slice(7).trim().split('.') : ['salt', 'sugar', 'fat', 'acid', 'heat', 'canvas', 'fresh'];
  const out = {};
  for (const l of lines) {
    const p = /^([a-z][a-z0-9_@]*)\s*\|\s*(prep|remove)(?:\s*\|\s*(\S+))?$/.exec(l);
    if (p) { out[p[1]] = { [p[2] === 'remove' ? 'remove' : 'prep']: true, ...(p[3] ? { at: p[3] } : {}) }; continue; }
    const v = /^([a-z][a-z0-9_@]*)\s*\|\s*t\s+([0-3](?:\.[0-3])*)\s*\|\s*s\s+([0-3](?:\.[0-3])*)\s*\|\s*v\s+([0-2])(?:\s*\|\s*(\S+))?$/.exec(l);
    if (v) {
      out[v[1]] = {
        texture: Object.fromEntries(tex.map((k, i) => [k, Number(v[2].split('.')[i] ?? 0)])),
        taste: Object.fromEntries(tas.map((k, i) => [k, Number(v[3].split('.')[i] ?? 0)])),
        verdict: Number(v[4]),
        ...(v[5] ? { at: v[5] } : {}),
      };
      continue;
    }
    const m = /^([a-z][a-z0-9_@]*)\s*\|\s*t\s+([0-3](?:\.[0-3])*)\s*\|\s*s\s+([a-z0-9 .-]+?)\s*\|\s*c\s+([1-5])(\s*\|\s*prep)?(\s*\|\s*assumed)?(?:\s*\|\s*(\S+))?$/.exec(l);
    if (!m) continue;
    const levels = m[2].split('.').map(Number);
    out[m[1]] = {
      texture: Object.fromEntries(tex.map((k, i) => [k, levels[i] ?? 0])),
      // v2: levels in the "tastes" order; v1 listed the tastes present, read as Medium.
      ...(/^[0-3](\.[0-3])*$/.test(m[3])
        ? { taste: Object.fromEntries(tas.map((k, i) => [k, Number(m[3].split('.')[i] ?? 0)])) }
        : { taste: Object.fromEntries((m[3] === '-' ? [] : m[3].split(/\s+/)).map((k) => [k, 2])), tasteAssumed: true }),
      centre: Number(m[4]),
      ...(m[5] ? { prep: true } : {}),
      ...(m[6] ? { tasteAssumed: true } : {}),
      ...(m[7] ? { at: m[7] } : {}),
    };
  }
  return out;
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
