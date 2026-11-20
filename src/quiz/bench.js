// v2 Step 4: the blind benchmark's answers as plain text, the same "Send to Harvey's" path
// as the quizzes. One dish per line: tier, then any reasons (veto and floor only), then the time.
//   #harveys benchmark v1
//   seed 20261121
//   combo_3 | veto | cooking.clash | 2026-11-21T09:12Z
//   chana_chaat | pass | - | 2026-11-21T09:13Z
//   tiers finer
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
  return [BENCH_HEADER, `seed ${sheet.seed}`, ...lines, ...(tiers ? [`tiers ${tiers}`] : [])].join('\n');
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
    const t = /^tiers (enough|finer)$/.exec(l);
    if (t) tiers = t[1];
    const s = /^seed (\d+)$/.exec(l);
    if (s) seed = Number(s[1]);
  }
  return { answers, tiers, seed };
}
