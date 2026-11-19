// Marco's quiz engine, after Kiron's: a quiz is a JSON file, played in short
// rounds, one screen at a time, and progress is saved after every screen.
// Unlike Kiron there is no right answer, so there are no streaks and no timer.
// Each food is rated in three steps (texture, taste, centre), every tap
// toggles, and Back steps to the previous screen, into the previous food too. Pure logic only (no DOM), so it is tested in Node.

export const STEPS = ['texture', 'taste', 'centre'];
export const HEADER = '#marco pierre-trainer v1';

/** Checks a quiz file and fills in defaults. Throws with every problem at once. */
export function validateQuiz(q) {
  const errs = [];
  if (q?.format !== 'marco-quiz') errs.push('format must be "marco-quiz"');
  for (const key of ['textures', 'tastes', 'centre', 'foods']) if (!Array.isArray(q?.[key]) || !q[key].length) errs.push(`${key} must be a non-empty list`);
  if (errs.length) throw new Error(errs.join('; '));
  const ids = new Set();
  for (const f of q.foods) {
    if (!/^[a-z][a-z0-9_]*$/.test(f.id ?? '')) errs.push(`bad food id "${f.id}"`);
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
  prep: false,
});

/** Foods not yet rated, the user's own kitchen first, each group shuffled. */
export function queue(quiz, state, rng = Math.random) {
  const left = quiz.foods.filter((f) => !state.answers[f.id]);
  return [...shuffle(left.filter((f) => f.kitchen), rng), ...shuffle(left.filter((f) => !f.kitchen), rng)].map((f) => f.id);
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
export function tapTaste(draft, key) {
  return { ...draft, taste: { ...draft.taste, [key]: draft.taste[key] ? 0 : 1 } };
}
export function tapCentre(draft, value) {
  return { ...draft, centre: draft.centre === value ? null : value };
}

/** "Part of prep, needs further processing" (soaked poha): no ratings, flagged for Pierre-tutor. */
export function tapPrep(draft) {
  return { ...draft, prep: !draft.prep };
}

/** Texture and taste can be all-none; the centre needs an answer, unless the food is only prep. */
export const canAdvance = (step, draft) => draft.prep || STEPS[step] !== 'centre' || draft.centre != null;

/** Next step, or the next food (saving this one), or the end of the round. */
export function advance(quiz, state, now = new Date()) {
  const r = state.round;
  if (!r || r.i >= r.ids.length || !canAdvance(r.step, r.draft)) return state;
  if (!r.draft.prep && r.step < STEPS.length - 1) return { ...state, round: { ...r, step: r.step + 1 } };
  const answer = r.draft.prep ? { prep: true } : (({ prep, ...rest }) => rest)(r.draft);
  const answers = { ...state.answers, [r.ids[r.i]]: { ...answer, at: now.toISOString() } };
  return { ...state, answers, round: { ...r, i: r.i + 1, step: 0, draft: blankDraft(quiz) } };
}

/** The previous screen: the step before, or the last step of the previous food, with its answer back in the draft. */
export function back(quiz, state) {
  const r = state.round;
  if (!r) return state;
  if (r.i < r.ids.length && r.step > 0 && !r.draft.prep) return { ...state, round: { ...r, step: r.step - 1 } };
  if (r.i === 0) return state;
  const i = r.i - 1;
  const a = state.answers[r.ids[i]];
  const blank = blankDraft(quiz);
  const draft = !a ? blank : a.prep ? { ...blank, prep: true } : {
    texture: { ...blank.texture, ...a.texture }, taste: { ...blank.taste, ...a.taste }, centre: a.centre ?? null, prep: false,
  };
  return { ...state, round: { ...r, i, step: a?.prep ? 0 : STEPS.length - 1, draft } };
}
export const canGoBack = (state) => !!state.round && (state.round.i > 0 || (state.round.step > 0 && !state.round.draft.prep));

export const roundOver = (state) => !state.round || state.round.i >= state.round.ids.length;
export const unsent = (state) => Object.keys(state.answers).filter((id) => !state.sent[id] || state.sent[id] < state.answers[id].at);
export const markSent = (state, ids, now = new Date()) => ({ ...state, sent: { ...state.sent, ...Object.fromEntries(ids.map((id) => [id, now.toISOString()])) } });

// ── "Send to Marco": a plain-text payload ───────────────────────────────────
// One food per line, readable by a person and parsed by scripts/ingest-pierre.mjs:
//   paneer | t 0.3.2.1.0 | s fat | c 4 | 2026-11-19T11:30:00.000Z
// t = crisp.creamy.chewy.juicy.flaky (0–3), s = tastes present (or -), c = centre 1–5.
// A food marked "part of prep" is one line with no ratings, for Pierre-tutor:
//   poha | prep | 2026-11-19T11:30:00.000Z
export function encodePayload(quiz, answers, ids = Object.keys(answers)) {
  const tex = quiz.textures.map((t) => t.id);
  const tas = quiz.tastes.map((t) => t.id);
  const lines = ids.filter((id) => answers[id]).map((id) => {
    const a = answers[id];
    if (a.prep) return `${id} | prep | ${a.at}`;
    const s = tas.filter((k) => a.taste[k]);
    return `${id} | t ${tex.map((k) => a.texture[k] ?? 0).join('.')} | s ${s.length ? s.join(' ') : '-'} | c ${a.centre} | ${a.at}`;
  });
  return [HEADER, `textures ${tex.join('.')}`, ...lines].join('\n');
}

export function decodePayload(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim());
  if (!lines.some((l) => l.startsWith('#marco pierre-trainer'))) throw new Error('not a Pierre-trainer export');
  const texLine = lines.find((l) => l.startsWith('textures '));
  const tex = texLine ? texLine.slice(9).trim().split('.') : ['crisp', 'creamy', 'chewy', 'juicy', 'flaky'];
  const out = {};
  for (const l of lines) {
    const p = /^([a-z][a-z0-9_@]*)\s*\|\s*prep(?:\s*\|\s*(\S+))?$/.exec(l);
    if (p) { out[p[1]] = { prep: true, ...(p[2] ? { at: p[2] } : {}) }; continue; }
    const m = /^([a-z][a-z0-9_@]*)\s*\|\s*t\s+([0-3](?:\.[0-3])*)\s*\|\s*s\s+([a-z -]+?)\s*\|\s*c\s+([1-5])(?:\s*\|\s*(\S+))?$/.exec(l);
    if (!m) continue;
    const levels = m[2].split('.').map(Number);
    out[m[1]] = {
      texture: Object.fromEntries(tex.map((k, i) => [k, levels[i] ?? 0])),
      taste: Object.fromEntries((m[3] === '-' ? [] : m[3].split(/\s+/)).map((k) => [k, 1])),
      centre: Number(m[4]),
      ...(m[5] ? { at: m[5] } : {}),
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
