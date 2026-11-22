// Tester feedback (1.34.0): the screens after White, before Send, and the report that reads
// them back. Pure: no DOM, no network, no clock.
//
// On the phone: one screen of chips ("What went wrong?"), then one short screen for each chip
// tapped, each answered by taps on the tester's own list or dishes. Typing is only ever
// optional. Everything is skippable.
//
// In the result file, `feedback` is structured, so scripts/kitchen-tests.mjs can count it:
// item names straight from the kitchen's list, dish ids straight from the quiz, chip ids.
// `summariseFeedback` pools every tester; `feedbackReport` turns that into Markdown.

import { matchTyped } from './confirm.js';
import { labelFor } from './vocabulary.js';

export const CHIPS = [
  { id: 'wrong_items', label: 'Wrong ingredients' },
  { id: 'missing_dishes', label: 'Missing dishes I’d make' },
  { id: 'too_hard', label: 'Too much effort' },
  { id: 'wouldnt_eat', label: 'Wouldn’t eat this' },
  { id: 'confusing', label: 'Confusing' },
  { id: 'all_good', label: 'All good' },
];
const CHIP_IDS = new Set(CHIPS.map((c) => c.id));
const chipLabel = (id) => CHIPS.find((c) => c.id === id)?.label ?? id;

/** Weeknight staples a tester can add with one tap ("What do you make?"). */
export const QUICK_DISHES = ['Maggi', 'Dal chawal', 'Poha', 'Upma', 'Curd rice', 'Paratha', 'Sandwich', 'Pasta', 'Fried rice', 'Khichdi', 'Rajma chawal', 'Omelette', 'Chai and toast', 'I’d order in'];
export const WOULDNT_WHY = [
  { id: 'taste', label: 'Don’t like it' },
  { id: 'diet', label: 'Not my diet' },
  { id: 'odd', label: 'Sounds odd' },
  { id: 'healthy', label: 'Not filling' },
];
export const CONFUSING = [
  { id: 'stars', label: 'The stars' },
  { id: 'recipe', label: 'Reading a recipe' },
  { id: 'task', label: 'What to do' },
  { id: 'names', label: 'Dish names' },
  { id: 'long', label: 'Too many questions' },
];
const SUB_IDS = { wouldntWhy: new Set(WOULDNT_WHY.map((x) => x.id)), confusing: new Set(CONFUSING.map((x) => x.id)) };

/** Follow-up screen for each chip, in the order shown. "All good" has none. */
export const FOLLOW_UPS = ['wrong_items', 'missing_dishes', 'too_hard', 'wouldnt_eat', 'confusing'];

export const blankFeedback = () => ({ chips: [], wrongItems: [], missedItems: [], dishIdeas: [], tooHard: [], wouldntEat: [], wouldntWhy: [], confusing: [], note: '', makes: '', ms: 0, seen: false });

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const text = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const uniq = (xs) => { const seen = new Set(); return xs.filter((x) => { const k = norm(x.name ?? x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };

/** A tester's typed list ("maggi, poha and dal") → separate names. */
export function splitIdeas(s) {
  return uniq(String(s ?? '').split(/[,\n;]+|\s+(?:and|&|\+)\s+/i).map((x) => text(x, 60)).filter(Boolean));
}

/** The quick-add staples this quiz didn't already show (no point offering what was on screen). */
export function quickDishes(quiz) {
  const shown = Object.values(quiz?.dishes ?? {}).map((d) => norm(d.name));
  return QUICK_DISHES.filter((q) => { const n = norm(q); return !shown.some((s) => s === n || ` ${s} `.includes(` ${n} `)); });
}

/** What the phone collected → what goes in the file. Only known chips, items and dishes. */
export function cleanFeedback(fb, quiz) {
  if (!fb || !fb.seen) return null; // never reached the screen (an older run, or closed early)
  const items = new Map((quiz?.kitchen?.items ?? []).map((i) => [norm(i.name), i.name]));
  const dishes = new Set(Object.keys(quiz?.dishes ?? {}));
  const chips = [...new Set((fb.chips ?? []).filter((c) => CHIP_IDS.has(c)))];
  const has = (c) => chips.includes(c);
  const out = {
    chips,
    skipped: !chips.length && !text(fb.note, 1) && !text(fb.makes, 1),
    allGood: has('all_good'),
    wrongItems: has('wrong_items') ? [...new Set((fb.wrongItems ?? []).map((n) => items.get(norm(n))).filter(Boolean))] : [],
    missedItems: has('wrong_items') ? uniq((fb.missedItems ?? []).map((n) => text(n, 60))).slice(0, 30) : [],
    // 1.44.0: "Meals or foods you often make" on the end screen counts as typed dish ideas too.
    dishIdeas: uniq([
      ...(has('missing_dishes') ? (fb.dishIdeas ?? []).map((d) => (typeof d === 'string' ? { name: text(d, 60), quick: false } : { name: text(d.name, 60), quick: !!d.quick })) : []),
      ...splitIdeas(fb.makes).map((name) => ({ name, quick: false, makes: true })),
    ]).filter((d) => d.name).slice(0, 30),
    tooHard: has('too_hard') ? [...new Set(fb.tooHard ?? [])].filter((id) => dishes.has(id)) : [],
    wouldntEat: has('wouldnt_eat') ? [...new Set(fb.wouldntEat ?? [])].filter((id) => dishes.has(id)) : [],
    wouldntWhy: has('wouldnt_eat') ? [...new Set(fb.wouldntWhy ?? [])].filter((id) => SUB_IDS.wouldntWhy.has(id)) : [],
    confusing: has('confusing') ? [...new Set(fb.confusing ?? [])].filter((id) => SUB_IDS.confusing.has(id)) : [],
    note: text(fb.note, 2000),
    makes: text(fb.makes, 1000),
    ms: Math.max(0, Math.round(fb.ms ?? 0)) || null,
  };
  return out;
}

// ── Reading it back ─────────────────────────────────────────────────────────

const DISH_ALIASES = { maggi: 'instant noodles', 'dal chawal': 'dal rice', 'chai and toast': 'toast', omelette: 'omelette' };
const STOP = new Set(['with', 'and', 'the', 'a', 'of', 'on', 'in', 'no', 'one', 'pot', 'quick']);
const words = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

/**
 * A dish idea → where it stands: 'order-in', 'shown' (it was on their screen), 'catalogue'
 * (Harvey's knows it, this kitchen didn't get it) or 'new' (a catalogue candidate).
 */
export function placeIdea(name, { shown = [], catalogue = [] } = {}) {
  const n = norm(DISH_ALIASES[norm(name)] ?? name);
  if (/\border\b/.test(n)) return { status: 'order-in' };
  const w = words(n);
  const match = (d) => { const dn = norm(d.name); const dw = new Set([...words(dn), ...words(String(d.id ?? '').replace(/_/g, ' '))]); return dn === n || (w.length > 0 && w.every((x) => dw.has(x))); };
  const s = shown.find(match);
  if (s) return { status: 'shown', dish: s.id ?? s.name };
  const c = catalogue.find(match);
  if (c) return { status: 'catalogue', dish: c.id };
  return { status: 'new' };
}

/**
 * The quick check (1.39.0, cookware and typed items 1.41.0) over every result: what testers
 * tapped (what videos miss), stoves and burners, and anything typed that Harvey's list has no
 * close match for. `fresh` is what pranjal wants to hear about first: each new thing, with who said it.
 */
export function summariseCheck(results) {
  const checked = results.filter((r) => r.confirm);
  const who = (r) => r.tester || r.testerId;
  const where = (r) => r.kitchen?.kitchen ?? r.kitchenId;
  const tally = new Map();
  const add = (key, r, extra = {}) => {
    const e = tally.get(key) ?? { n: 0, testers: [], kitchens: new Set(), ...extra };
    e.n++;
    e.testers.push(who(r));
    e.kitchens.add(where(r));
    tally.set(key, e);
  };
  const fresh = new Map();
  for (const r of checked) {
    const c = r.confirm;
    for (const id of new Set([...(c.have ?? []), ...(c.typed ?? []).filter((t) => t.id).map((t) => t.id)])) add(id, r);
    for (const t of c.typed ?? []) if (!t.id) {
      const k = norm(t.text);
      const e = fresh.get(k) ?? { name: t.text, n: 0, from: [], testers: [], kitchens: new Set() };
      e.n++;
      e.from.push('quick check');
      e.testers.push(who(r));
      e.kitchens.add(where(r));
      fresh.set(k, e);
    }
  }
  // "In the kitchen but not listed" on the feedback screen is typed too: same test.
  for (const r of results) for (const name of r.feedback?.missedItems ?? []) {
    if (matchTyped(name).id) continue;
    const k = norm(name);
    const e = fresh.get(k) ?? { name, n: 0, from: [], testers: [], kitchens: new Set() };
    e.n++;
    e.from.push('feedback');
    e.testers.push(who(r));
    e.kitchens.add(where(r));
    fresh.set(k, e);
  }
  const list = (m) => [...m.entries()].map(([key, e]) => ({ key, ...e, kitchens: [...e.kitchens] })).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
  return {
    checked: checked.length,
    have: list(tally).map((e) => ({ id: e.key, label: labelFor(e.key), n: e.n, testers: e.testers, kitchens: e.kitchens })),
    noStove: checked.filter((r) => r.confirm.noStove).map((r) => ({ tester: who(r), kitchen: where(r), stove: [...(r.confirm.have ?? []), ...(r.confirm.typed ?? []).map((t) => t.id)].filter((id) => id === 'gas_stove' || id === 'induction').map(labelFor) })),
    burners: checked.filter((r) => r.confirm.burners).map((r) => ({ tester: who(r), kitchen: where(r), n: r.confirm.burners })),
    // 1.44.0: listed items testers unticked (the video agent saw something that isn't there)
    removed: list((() => { const m = new Map(); for (const r of checked) for (const n of r.confirm.removed ?? []) { const k = norm(n); const e = m.get(k) ?? { name: n, n: 0, testers: [], kitchens: new Set() }; e.n++; e.testers.push(who(r)); e.kitchens.add(where(r)); m.set(k, e); } return m; })()).map((e) => ({ name: e.name, n: e.n, testers: e.testers, kitchens: e.kitchens })),
    bonus: results.filter((r) => r.bonus).map((r) => ({ tester: who(r), kitchen: where(r), name: r.bonus.name, need: r.bonus.need?.label, effort: r.bonus.effort, taste: r.bonus.taste, want: r.bonus.want, have: r.bonus.have })),
    fresh: list(fresh).map((e) => ({ name: e.name, n: e.n, from: [...new Set(e.from)], testers: e.testers, kitchens: e.kitchens })),
  };
}

/** Every rung-quiz result with feedback → one pooled summary. */
export function summariseFeedback(results, { catalogue = [] } = {}) {
  const withFb = results.filter((r) => r.feedback);
  const count = (pick) => {
    const m = new Map();
    for (const r of withFb) for (const x of new Set(pick(r))) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([key, n]) => ({ key, n }));
  };
  const dishName = (r, id) => r.dishes?.[id]?.name ?? id;
  const ideas = new Map();
  for (const r of withFb) for (const d of r.feedback.dishIdeas ?? []) {
    const key = norm(DISH_ALIASES[norm(d.name)] ?? d.name);
    const shown = Object.entries(r.dishes ?? {}).map(([id, x]) => ({ id, name: x.name }));
    const place = placeIdea(d.name, { shown, catalogue });
    const e = ideas.get(key) ?? { name: d.name, n: 0, quick: 0, typed: 0, status: place.status, dish: place.dish ?? null, kitchens: new Set(), testers: [] };
    e.n++;
    d.quick ? e.quick++ : e.typed++;
    e.kitchens.add(r.kitchen?.kitchen ?? r.kitchenId);
    e.testers.push(r.testerId);
    // "new" anywhere beats "shown" elsewhere: the catalogue still lacks it for that kitchen.
    if (place.status === 'new') e.status = 'new';
    ideas.set(key, e);
  }
  const dishVotes = (field) => count((r) => (r.feedback[field] ?? []).map((id) => `${id}\t${dishName(r, id)}\t${r.dishes?.[id]?.rung ?? ''}\t${r.dishes?.[id]?.harveys?.tier ?? ''}`))
    .map(({ key, n }) => { const [id, name, rung, tier] = key.split('\t'); return { id, name, rung: Number(rung) || null, tier: tier || null, n }; });
  return {
    check: summariseCheck(results),
    testers: results.length,
    answered: withFb.length,
    skipped: withFb.filter((r) => r.feedback.skipped).length,
    chips: count((r) => r.feedback.chips ?? []).map(({ key, n }) => ({ id: key, label: chipLabel(key), n })),
    wrongItems: count((r) => r.feedback.wrongItems ?? []).map(({ key, n }) => ({ name: key, n })),
    missedItems: count((r) => (r.feedback.missedItems ?? []).map(norm)).map(({ key, n }) => ({ name: key, n })),
    ideas: [...ideas.values()].map((e) => ({ ...e, kitchens: [...e.kitchens] })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    tooHard: dishVotes('tooHard'),
    wouldntEat: dishVotes('wouldntEat'),
    wouldntWhy: count((r) => r.feedback.wouldntWhy ?? []).map(({ key, n }) => ({ id: key, label: WOULDNT_WHY.find((x) => x.id === key)?.label ?? key, n })),
    confusing: count((r) => r.feedback.confusing ?? []).map(({ key, n }) => ({ id: key, label: CONFUSING.find((x) => x.id === key)?.label ?? key, n })),
    makes: withFb.filter((r) => r.feedback.makes).map((r) => ({ tester: r.tester || r.testerId, kitchen: r.kitchen?.kitchen ?? r.kitchenId, makes: r.feedback.makes })),
    notes: withFb.filter((r) => r.feedback.note).map((r) => ({ kitchen: r.kitchen?.kitchen ?? r.kitchenId, testerId: r.testerId, at: r.at, note: r.feedback.note })),
  };
}

/** The quick-check part of the report. New things lead: they're what pranjal asked to hear about. */
export function checkReport(c) {
  if (!c) return [];
  const L = [];
  const by = (e) => `${e.testers.join(', ')}${e.kitchens.length ? `; ${e.kitchens.join(', ')}` : ''}`;
  if (c.fresh.length) {
    L.push('## New from testers (not in Harvey’s list)', '');
    L.push('Typed by testers with no close match. Add to the vocabulary (and a dish) if it matters.', '');
    for (const e of c.fresh) L.push(`- **${e.name}** (${e.n}) from ${e.from.join(' and ')}: ${by(e)}`);
    L.push('');
  }
  if (!c.checked) return L;
  L.push(`## Quick check: what the videos missed (${c.checked} tester(s))`, '');
  L.push(c.have.length ? c.have.map((e) => `${e.label} (${e.n})`).join(', ') : 'Nobody tapped anything.', '');
  if (c.noStove.length) L.push(`**No stove on the list:** ${c.noStove.map((x) => `${x.tester} (${x.kitchen}) → ${x.stove.join(' + ') || 'none tapped'}`).join('; ')}`, '');
  if (c.removed?.length) L.push(`**Listed but not in the kitchen (unticked):** ${c.removed.map((e) => `${e.name} (${e.n})`).join(', ')}`, '');
  if (c.bonus?.length) {
    L.push('## Bonus: one more thing', '', '| Tester | Kitchen | Needs | Dish | Effort | Taste | Would get it |', '|---|---|---|---|---|---|---|');
    for (const b of c.bonus) L.push(`| ${b.tester} | ${b.kitchen} | ${b.need ?? '-'} | ${b.name} | ${b.effort ?? '-'} | ${b.taste ?? '-'} | ${b.have ? 'has it' : b.want ?? '-'} |`);
    L.push('');
  }
  if (c.burners.length) L.push(`**Burners at once:** ${c.burners.map((x) => `${x.tester} ${x.n === 3 ? '3+' : x.n}`).join(', ')}`, '');
  return L;
}

/** The pooled summary → a Markdown report for pranjal and for Claude. */
export function feedbackReport(s, { title = 'Tester feedback' } = {}) {
  const L = [];
  const list = (xs, f) => (xs.length ? xs.map(f).join(', ') : '-');
  L.push(`# ${title}`, '');
  L.push(`${s.testers} taste test(s); ${s.answered} reached the feedback screen; ${s.skipped} skipped it.`, '');
  L.push(...checkReport(s.check));
  if (!s.answered) { L.push('No feedback yet. It starts with results from 1.34.0.'); return L.join('\n') + '\n'; }

  L.push('## What went wrong', '');
  L.push('| | Testers |', '|---|---|');
  for (const c of s.chips) L.push(`| ${c.label} | ${c.n} of ${s.answered} |`);
  if (!s.chips.length) L.push('| (no chips tapped) | |');
  L.push('');

  const fresh = s.ideas.filter((x) => x.status === 'new');
  const known = s.ideas.filter((x) => x.status === 'catalogue');
  const shown = s.ideas.filter((x) => x.status === 'shown');
  const orderIn = s.ideas.filter((x) => x.status === 'order-in');
  L.push('## Dishes testers would make instead', '');
  L.push(`**New for the catalogue** (Harvey's has no recipe): ${list(fresh, (x) => `${x.name} (${x.n})`)}`);
  L.push(`**In the catalogue but not offered** (check what the kitchen lacked): ${list(known, (x) => `${x.name} → \`${x.dish}\` (${x.n})`)}`);
  if (shown.length) L.push(`**Already on their screen** (they wanted it higher): ${list(shown, (x) => `${x.name} (${x.n})`)}`);
  if (orderIn.length) L.push(`**Would order in instead:** ${orderIn.reduce((a, x) => a + x.n, 0)}`);
  L.push('');

  L.push('## The kitchen list (what the video agent got wrong)', '');
  L.push(`**Listed but not in the kitchen:** ${list(s.wrongItems, (x) => `${x.name} (${x.n})`)}`);
  L.push(`**In the kitchen but not listed:** ${list(s.missedItems, (x) => `${x.name} (${x.n})${matchTyped(x.name).id ? '' : ' (new)'}`)}`, '');

  if (s.tooHard.length || s.wouldntEat.length) {
    L.push('## Dishes flagged', '');
    L.push('| Dish | Rung | Pierre | Too much effort | Wouldn’t eat |', '|---|---|---|---|---|');
    const ids = [...new Set([...s.tooHard, ...s.wouldntEat].map((d) => d.id))];
    for (const id of ids) {
      const h = s.tooHard.find((d) => d.id === id);
      const w = s.wouldntEat.find((d) => d.id === id);
      const d = h ?? w;
      L.push(`| ${d.name} | ${d.rung ?? '-'} | ${d.tier ?? '-'} | ${h?.n ?? ''} | ${w?.n ?? ''} |`);
    }
    if (s.wouldntWhy.length) L.push('', `Why not eat it: ${list(s.wouldntWhy, (x) => `${x.label} (${x.n})`)}`);
    L.push('');
  }
  if (s.confusing.length) L.push('## Confusing', '', list(s.confusing, (x) => `${x.label} (${x.n})`), '');
  if (s.makes?.length) {
    L.push('## What testers make, word for word', '');
    for (const m of s.makes) L.push(`- **${m.tester}** (${m.kitchen}): ${m.makes.replace(/\n/g, ' ')}`);
    L.push('');
  }
  if (s.notes.length) {
    L.push('## Notes, word for word', '');
    for (const n of s.notes) L.push(`> ${n.note.replace(/\n/g, ' ')}`, `> — ${n.kitchen}, ${n.testerId}`, '');
  }
  return L.join('\n') + '\n';
}
