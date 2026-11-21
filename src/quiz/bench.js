// v2 Step 4: the blind benchmark's answers as plain text, the same "Send to Harvey's" path
// as the quizzes. One dish per line: tier, then any reasons (veto and floor only), then the time.
//   #harveys benchmark v1
//   seed 20261121
//   combo_3 | veto | cooking.clash | 2026-11-21T09:12Z
//   chana_chaat | pass | - | 2026-11-21T09:13Z
//   tiers finer
//   fix combo_3 | garlic@sauteed.paneer@air_fried.-salt | pass
// A fix (veto and floor only, optional) lists each changed part: id@technique for new cooking,
// a bare id for "as it is", -id for dropped. The last field is the tier the fixed dish reaches.
// "tiers enough|finer" is the last screen's answer: were four tiers enough, or did some dishes
// need finer steps (the 0–5 spoons question). Pure logic, tested in Node.
export const BENCH_HEADER = '#harveys benchmark v1';
export const TIER_IDS = ['veto', 'floor', 'pass', 'crave'];

// Tap-to-repair (21 Nov): a dish can also carry a repair, one or more chain slots swapped
// (ingredients.js toDishChain) and the tier the repaired dish reaches:
//   repair r3_potato_mayo | before=floor | edit=cookedWith:none->oil | after=crave | scope=class | at=2026-11-21T08:15Z
// A list slot (seasonedWith) joins its ids with '.', 'none' is empty. scope=class teaches the fix
// to every food of the anchor's class cooked that way; scope=dish keeps it to this dish.
// scripts/ingest-pierre.mjs turns these lines into learned rules.
export const SCOPES = ['class', 'dish'];
// Fixing the medium or the cooking is physics, so it generalises by default; a topping or a dip
// is taste, so it stays with the dish.
const CLASS_SLOTS = ['cookedWith', 'technique'];
const norm = (slot, v) => {
  if (slot === 'seasonedWith') return [...(v ?? [])].sort();
  if (v && typeof v === 'object') return v.id ?? null;
  return v ?? null;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Records a slot swap on an answer, against the dish's original chain. Swapping back to the
 * original value removes that edit; with no edits left the repair is gone. Pure: returns a new draft.
 */
export function editSlot(draft, slot, value, original) {
  const d = { ...(draft ?? {}) };
  const from = norm(slot, original?.[slot]);
  const to = norm(slot, value);
  const edits = (d.repair?.edits ?? []).filter((e) => e.slot !== slot);
  if (!same(from, to)) edits.push({ slot, from, to });
  if (!edits.length) { d.repair = null; return d; }
  const scope = d.repair?.scopePicked ? d.repair.scope : edits.some((e) => CLASS_SLOTS.includes(e.slot)) ? 'class' : 'dish';
  d.repair = { afterTier: null, ...(d.repair ?? {}), edits, scope };
  return d;
}
export function setRepairTier(draft, tier) {
  if (!draft?.repair) return draft;
  return { ...draft, repair: { ...draft.repair, afterTier: TIER_IDS.includes(tier) ? tier : null, at: new Date().toISOString() } };
}
export function setRepairScope(draft, scope) {
  if (!draft?.repair || !SCOPES.includes(scope)) return draft;
  return { ...draft, repair: { ...draft.repair, scope, scopePicked: true } };
}
export function clearRepairs(draft) {
  return { ...(draft ?? {}), repair: null };
}

const word = (slot, v) => (slot === 'seasonedWith' ? (v?.length ? v.join('.') : 'none') : v ?? 'none');
const unword = (slot, w) => (slot === 'seasonedWith' ? (w === 'none' ? [] : w.split('.')) : w === 'none' ? null : w);
/** A repair's export line, or '' when it isn't complete (a before tier, edits and an after tier). */
export function repairLine(id, a) {
  const r = a?.repair;
  if (!a?.tier || !r?.edits?.length || !r.afterTier) return '';
  const minute = (at) => (typeof at === 'string' && at.length > 17 ? `${at.slice(0, 16)}Z` : at);
  const edits = r.edits.map((e) => `edit=${e.slot}:${word(e.slot, e.from)}->${word(e.slot, e.to)}`);
  const at = r.at ?? a.at;
  return [`repair ${id}`, `before=${a.tier}`, ...edits, `after=${r.afterTier}`, `scope=${r.scope ?? 'dish'}`, ...(at ? [`at=${minute(at)}`] : [])].join(' | ');
}
/** Parses one repair line: { dishId, before, edits, after, scope, at } or null. */
export function parseRepairLine(line) {
  if (!/^repair [a-z][a-z0-9_]*\s*\|/.test(line)) return null;
  const [head, ...fields] = line.split('|').map((x) => x.trim());
  const out = { dishId: head.slice(7).trim(), before: null, edits: [], after: null, scope: 'dish', at: null };
  for (const f of fields) {
    const [k, v] = [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)];
    if (k === 'before' && TIER_IDS.includes(v)) out.before = v;
    else if (k === 'after' && TIER_IDS.includes(v)) out.after = v;
    else if (k === 'scope' && SCOPES.includes(v)) out.scope = v;
    else if (k === 'at') out.at = v;
    else if (k === 'edit') {
      const m = /^([a-zA-Z]+):([a-z0-9_.]*)->([a-z0-9_.]*)$/.exec(v);
      if (m) out.edits.push({ slot: m[1], from: unword(m[1], m[2]), to: unword(m[1], m[3]) });
    }
  }
  return out.edits.length && out.after ? out : null;
}

export function encodeBench(sheet, answers, tiers = null) {
  const minute = (at) => (typeof at === 'string' && at.length > 17 ? `${at.slice(0, 16)}Z` : at);
  const lines = sheet.dishes.filter((d) => answers[d.id]?.tier).map((d) => {
    const a = answers[d.id];
    const why = a.tier === 'veto' || a.tier === 'floor' ? (a.reasons ?? []) : [];
    return `${d.id} | ${a.tier} | ${why.length ? why.join('.') : '-'} | ${minute(a.at)}`;
  });
  const fixes = sheet.dishes.filter((d) => fixLine(d, answers[d.id])).map((d) => `fix ${d.id} | ${fixLine(d, answers[d.id])} | ${answers[d.id].fix.tier}`);
  const repairs = sheet.dishes.map((d) => repairLine(d.id, answers[d.id])).filter(Boolean);
  return [BENCH_HEADER, `seed ${sheet.seed}`, ...lines, ...fixes, ...repairs, ...(tiers ? [`tiers ${tiers}`] : [])].join('\n');
}

/** The changed parts of a fix, or '' when there is no complete fix (changes and a tier). */
export function fixLine(dish, a) {
  if (!a?.fix?.tier || !(a.tier === 'veto' || a.tier === 'floor')) return '';
  const out = Object.entries(a.fix.changes ?? {}).filter(([i, v]) => dish.items[i] && v !== (dish.items[i].technique ?? '')).map(([i, v]) => {
    const id = dish.items[i].id;
    return v === 'drop' ? `-${id}` : v ? `${id}@${v}` : id;
  });
  return out.join('.');
}

/** A dish's parts after a fix line: [{ id, technique? }] with dropped parts gone. */
export function applyFix(items, line) {
  const ch = Object.fromEntries(line.split('.').filter(Boolean).map((c) => (c.startsWith('-') ? [c.slice(1), 'drop'] : [c.split('@')[0], c.split('@')[1] ?? ''])));
  return items.filter((it) => ch[it.id] !== 'drop').map((it) => {
    if (!(it.id in ch)) return it;
    const { technique, ...rest } = it;
    return ch[it.id] ? { ...rest, technique: ch[it.id], mod: false } : { ...rest };
  });
}

export function decodeBench(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim());
  if (!lines.includes(BENCH_HEADER)) throw new Error('not a benchmark export');
  const answers = {};
  let tiers = null;
  let seed = null;
  const repairs = [];
  for (const l of lines) {
    const m = /^([a-z][a-z0-9_]*)\s*\|\s*(veto|floor|pass|crave)\s*\|\s*([a-z.]+|-)\s*(?:\|\s*(\S+))?$/.exec(l);
    if (m) { answers[m[1]] = { tier: m[2], reasons: m[3] === '-' ? [] : m[3].split('.'), ...(m[4] ? { at: m[4] } : {}) }; continue; }
    const f = /^fix ([a-z][a-z0-9_]*)\s*\|\s*([a-z0-9_@.-]+)\s*\|\s*(veto|floor|pass|crave)$/.exec(l);
    if (f && answers[f[1]]) { answers[f[1]].fix = { line: f[2], tier: f[3] }; continue; }
    const r = parseRepairLine(l);
    if (r) {
      if (answers[r.dishId]) answers[r.dishId].repair = { edits: r.edits, afterTier: r.after, scope: r.scope, ...(r.at ? { at: r.at } : {}) };
      repairs.push(r);
      continue;
    }
    const t = /^tiers (enough|finer)$/.exec(l);
    if (t) tiers = t[1];
    const s = /^seed (\d+)$/.exec(l);
    if (s) seed = Number(s[1]);
  }
  return { answers, tiers, seed, repairs };
}
