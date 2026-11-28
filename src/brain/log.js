// White v2's live learning (Step 5B): what "Cooked this" and "Fix / Veto" record.
// Pure: the page passes the time and stores the entries (localStorage marco.cookLog,
// marco.liveRepairs); Debug's "Copy for Claude" carries both.

import { toDishChain, TIERS } from './ingredients.js';

const r3 = (n) => Number((Number(n) || 0).toFixed(3));
const brief = (item) => ({ id: item.meal.id, tier: item.pierre.tier, payoff: r3(item.payoff.value), friction: r3(item.friction) });

/**
 * One "Cooked this" tap. `ladderShown` is every rung's pick (cross-rung skips);
 * `alternativesShown` is the rest of the chosen rung (within-rung overrides).
 */
export function cookLogEntry({ chosen, ladder, context = {}, at }) {
  const group = ladder.find((g) => g.pick.meal.id === chosen.meal.id || g.alternatives.some((a) => a.meal.id === chosen.meal.id));
  return {
    dishId: chosen.meal.id,
    rung: group?.rung ?? chosen.rung ?? null,
    tier: chosen.pierre.tier,
    ladderShown: ladder.map((g) => ({ rung: g.rung, pickId: g.pick.meal.id, tier: g.pick.pierre.tier, payoff: r3(g.pick.payoff.value), friction: r3(g.pick.friction) })),
    alternativesShown: group ? [group.pick, ...group.alternatives].filter((x) => x.meal.id !== chosen.meal.id).map(brief) : [],
    context,
    at,
  };
}

/** One "Fix / Veto" from the result screen: your tier for this exact dish, and what would fix it. */
export function liveRepairEntry({ item, tier, fix = '', at }) {
  if (!TIERS.includes(tier)) throw new Error(`unknown tier ${tier}`);
  const modifiers = item.used?.ingredients?.map((i) => i.id) ?? [];
  return {
    dishId: item.meal.id,
    name: item.meal.name,
    form: item.meal.form ?? null,
    parts: item.meal.parts ?? null,
    modifiers,
    chain: item.meal.parts ? toDishChain({ parts: item.meal.parts, modifiers }) : null,
    pierre: item.pierre.tier,
    yours: tier,
    fix: String(fix).trim().slice(0, 200),
    at,
  };
}

/** Your latest live tier per dish, as verdicts rank() applies straight away (a veto hides it). */
export function liveVerdicts(liveRepairs = []) {
  const out = {};
  for (const r of [...liveRepairs].sort((a, b) => String(a.at).localeCompare(String(b.at)))) out[r.dishId] = { tier: r.yours, why: r.fix || 'Fix / Veto on the result screen' };
  return out;
}

// ── 1.64.0: live events go home on their own ────────────────────────────────
// Each "Cooked this" and "Fix / Veto" is also sent, in the background, to the relay's
// POST /log (relay/worker.js), which commits it as one new file in data/cook-logs/.
// Nothing identifies the person: a random deviceId made on this phone, and a random eventId
// per event so a resend is recognised as the same file.

export const COOK_LOG_FORMAT = 'harveys-cook-log/1';
export const LIVE_REPAIR_FORMAT = 'harveys-live-repair/1';
export const LIVE_FORMATS = Object.freeze({ cook: COOK_LOG_FORMAT, repair: LIVE_REPAIR_FORMAT });
export const DEVICE_ID = /^[a-z0-9]{6,16}$/;
export const EVENT_ID = /^[a-z0-9-]{8,32}$/;

/** A random lowercase id of `n` letters and digits. `rand` is injectable for tests. */
export function randomId(n = 10, rand = (k) => crypto.getRandomValues(new Uint8Array(k))) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...rand(n)].map((b) => abc[b % abc.length]).join('');
}

/** The envelope one live event travels in. → { format, version, deviceId, eventId, at, entry } */
export function encodeLiveEvent({ kind, entry, deviceId, eventId, version }) {
  const format = LIVE_FORMATS[kind];
  if (!format) throw new Error(`unknown live event kind ${kind}`);
  if (!DEVICE_ID.test(String(deviceId))) throw new Error('bad deviceId');
  if (!EVENT_ID.test(String(eventId))) throw new Error('bad eventId');
  return { format, version: String(version ?? ''), deviceId, eventId, at: entry.at, entry };
}

/**
 * Many data/cook-logs/ files (parsed) → { cookLog, repairs }, each entry once (by eventId),
 * oldest first. `device` keeps one phone's events only. Anything that isn't a live event is skipped.
 */
export function poolLiveEvents(docs, { device = null } = {}) {
  const seen = new Set();
  const cookLog = [];
  const repairs = [];
  for (const d of docs) {
    if (!d || typeof d !== 'object' || !d.entry || !Object.values(LIVE_FORMATS).includes(d.format)) continue;
    if (device && d.deviceId !== device) continue;
    if (seen.has(d.eventId)) continue;
    seen.add(d.eventId);
    (d.format === COOK_LOG_FORMAT ? cookLog : repairs).push({ ...d.entry, deviceId: d.deviceId, eventId: d.eventId });
  }
  const byAt = (a, b) => String(a.at).localeCompare(String(b.at));
  return { cookLog: cookLog.sort(byAt), repairs: repairs.sort(byAt) };
}
