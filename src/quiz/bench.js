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

export function encodeBench(sheet, answers, tiers = null) {
  const minute = (at) => (typeof at === 'string' && at.length > 17 ? `${at.slice(0, 16)}Z` : at);
  const lines = sheet.dishes.filter((d) => answers[d.id]?.tier).map((d) => {
    const a = answers[d.id];
    const why = a.tier === 'veto' || a.tier === 'floor' ? (a.reasons ?? []) : [];
    return `${d.id} | ${a.tier} | ${why.length ? why.join('.') : '-'} | ${minute(a.at)}`;
  });
  const fixes = sheet.dishes.filter((d) => fixLine(d, answers[d.id])).map((d) => `fix ${d.id} | ${fixLine(d, answers[d.id])} | ${answers[d.id].fix.tier}`);
  return [BENCH_HEADER, `seed ${sheet.seed}`, ...lines, ...fixes, ...(tiers ? [`tiers ${tiers}`] : [])].join('\n');
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
  for (const l of lines) {
    const m = /^([a-z][a-z0-9_]*)\s*\|\s*(veto|floor|pass|crave)\s*\|\s*([a-z.]+|-)\s*(?:\|\s*(\S+))?$/.exec(l);
    if (m) { answers[m[1]] = { tier: m[2], reasons: m[3] === '-' ? [] : m[3].split('.'), ...(m[4] ? { at: m[4] } : {}) }; continue; }
    const f = /^fix ([a-z][a-z0-9_]*)\s*\|\s*([a-z0-9_@.-]+)\s*\|\s*(veto|floor|pass|crave)$/.exec(l);
    if (f && answers[f[1]]) { answers[f[1]].fix = { line: f[2], tier: f[3] }; continue; }
    const t = /^tiers (enough|finer)$/.exec(l);
    if (t) tiers = t[1];
    const s = /^seed (\d+)$/.exec(l);
    if (s) seed = Number(s[1]);
  }
  return { answers, tiers, seed };
}
