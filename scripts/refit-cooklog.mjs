// Refit Marco's friction weights from real dinners ("Cooked this").
//
//   node scripts/refit-cooklog.mjs                      every phone's dinners in data/cook-logs/
//   node scripts/refit-cooklog.mjs --device <deviceId>  one phone's dinners only
//   node scripts/refit-cooklog.mjs <file> [<file> …]    Debug → "Copy for Claude" pastes, bare
//                                                       cookLog arrays, or cook-*.json files
//   options: [--min 20] [--json] [--dir data/cook-logs]
//
// 1.64.0: phones send each "Cooked this" and "Fix / Veto" to data/cook-logs/ on their own
// (relay POST /log). With no file this pools that folder, each event once (by eventId), and
// lists the live Fix / Veto disagreements under the weights.
// Prints the fitted weights next to the ones in src/brain/config.js and a frictionTheta
// block to paste in. It never edits config: you review, then PR.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/brain/config.js';
import { cookLogFrom, refitFromCookLog } from '../src/brain/refit.js';
import { poolLiveEvents } from '../src/brain/log.js';

const args = process.argv.slice(2);
const valued = new Set(['--min', '--device', '--dir']);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const files = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const min = Number(opt('--min')) || 20;
const device = opt('--device');
const dir = opt('--dir') ?? new URL('../data/cook-logs/', import.meta.url).pathname;

/** Every source → { cookLog, repairs }. Live envelopes are pooled and deduped; pastes pass through. */
export function gather({ files = [], dir, device = null }) {
  const docs = [];
  const pasted = [];
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const take = (d) => {
    if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.format === 'string' && d.entry) docs.push(d);
    else pasted.push(...cookLogFrom(d));
  };
  if (files.length) for (const f of files) take(read(f));
  else if (dir && existsSync(dir)) {
    for (const n of readdirSync(dir).filter((n) => /^(cook|repair)-.*\.json$/.test(n)).sort()) {
      try { docs.push(read(join(dir, n))); } catch { console.error(`skipped ${n}: not JSON`); }
    }
  }
  const pool = poolLiveEvents(docs, { device });
  return { cookLog: [...pasted, ...pool.cookLog], repairs: pool.repairs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { cookLog, repairs } = gather({ files, dir, device });
  if (!cookLog.length && !repairs.length) {
    console.error(files.length ? 'no dinners in those files' : `no dinners in ${dir}${device ? ` for device ${device}` : ''} yet`);
    process.exit(1);
  }
  const r = refitFromCookLog(cookLog, { current: DEFAULT_CONFIG.frictionTheta });

  if (args.includes('--json')) {
    console.log(JSON.stringify({ dinners: r.dinners, pairs: r.pairs, skipped: r.skipped, hits: r.fit.hits, looHits: r.fit.looHits, priorHits: r.fit.priorHits, frictionTheta: r.frictionTheta, fitted: r.payload.frictionTheta, repairs: repairs.length }, null, 1));
    process.exit(0);
  }

  const f3 = (n) => (n == null ? '-' : (n >= 0 ? ' ' : '') + n.toFixed(3));
  const phones = new Set(cookLog.map((e) => e.deviceId).filter(Boolean));
  console.log(`${cookLog.length} logged dinners${phones.size ? ` from ${phones.size} phone${phones.size > 1 ? 's' : ''}` : ''}${device ? ` (device ${device})` : ''}, ${r.dinners} usable, ${r.pairs} pairs (cooked vs shown).`);
  if (r.skipped.length) console.log(`Not in the catalogue (skipped): ${r.skipped.join(', ')}`);
  if (r.dinners < min) console.log(`\nWARNING: only ${r.dinners} usable dinners (want ${min}+). Don't ship these weights yet.`);
  console.log(`In-sample ${r.fit.hits}/${r.pairs}, leave-one-out ${r.fit.looHits ?? '-'}/${r.pairs}, current weights ${r.fit.priorHits}/${r.pairs}.\n`);
  console.log('feature     now      fitted   proposed');
  for (const d of r.diff) console.log(`${d.key.padEnd(10)} ${f3(d.now)}   ${f3(d.fitted)}   ${f3(d.proposed)}${d.fitted > 0 ? '  (fitted positive, clamped)' : ''}`);
  console.log(`\n// src/brain/config.js → DEFAULT_CONFIG\nfrictionTheta: Object.freeze(${JSON.stringify(r.frictionTheta)}),`);
  if (repairs.length) {
    console.log(`\nLive repairs (${repairs.length})`);
    for (const x of repairs) console.log(`  ${x.dishId}: ${x.pierre ?? '?'} → ${x.yours}${x.fix ? ` ("${x.fix}")` : ''}`);
  }
}
