// The saved kitchen (1.60.0). Until 1.59 every page load started clean, because the site was a
// demo and a taste test. Now the home page is the app: what you confirmed once stays on this
// phone (localStorage harveys.kitchen.v1), so a returning visit opens straight on the ladder.
//
// Nothing here touches the DOM or the network; the page passes storage in. The older keys
// (marco.cookLog, marco.liveRepairs, marco.soaked, marco.ai, marco.pantry) are left alone.
//
// A backup link carries the same kitchen in its fragment (#restore=…), packed the way share
// links are (deflate-raw + base64url), so a new phone gets the kitchen with no account.

import { buildInventory, matchName } from './inventory.js';
import { labelFor, kindOf } from './vocabulary.js';
import { norm } from './feedback.js';
import { packText, unpackText } from './share-link.js';

export const KITCHEN_KEY = 'harveys.kitchen.v1';
export const VERSION = 1;
const MAX_ITEMS = 400;

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/** One stored item: { name, canonical, category, source }. Strings and loose objects are accepted. */
function cleanItem(item) {
  const raw = typeof item === 'string' ? { name: item } : item;
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  const canonical = typeof raw.canonical === 'string' && kindOf(raw.canonical) ? raw.canonical : null;
  const out = { name, canonical, category: cleanName(raw.category).slice(0, 20) || 'other', source: cleanName(raw.source).slice(0, 12) || 'saved' };
  if (raw.quantity) out.quantity = cleanName(raw.quantity).slice(0, 30);
  return out;
}

/** One item per thing: the same canonical id, or the same name, is kept once (the first). */
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.canonical ? `id:${it.canonical}` : `n:${norm(it.name)}`;
    const byName = `n:${norm(it.name)}`;
    if (seen.has(key) || seen.has(byName)) continue;
    seen.add(key);
    seen.add(byName);
    out.push(it);
  }
  return out;
}

/** Ways as saved: { question: [option ids] }, strings only. */
function cleanWays(ways) {
  if (!ways || typeof ways !== 'object' || Array.isArray(ways)) return null;
  const out = {};
  for (const [q, opts] of Object.entries(ways)) if (Array.isArray(opts)) out[String(q).slice(0, 40)] = opts.filter((o) => typeof o === 'string').map((o) => o.slice(0, 40)).slice(0, 12);
  return out;
}

/** A kitchen as stored, from anything (an old save, a backup, the setup screens). Null if it has no items. */
export function normalizeKitchen(raw, at = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object') return null;
  const items = dedupe((Array.isArray(raw.items) ? raw.items : []).map(cleanItem).filter(Boolean)).slice(0, MAX_ITEMS);
  if (!items.length) return null;
  return {
    version: VERSION,
    items,
    ways: cleanWays(raw.ways),
    missingBasics: Array.isArray(raw.missingBasics) ? raw.missingBasics.filter((x) => typeof x === 'string').slice(0, 20) : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : at,
  };
}

export function loadKitchen(ls = globalThis.localStorage) {
  try { return normalizeKitchen(JSON.parse(ls?.getItem(KITCHEN_KEY) ?? 'null')); } catch { return null; }
}

/** Saves (or, with null, forgets) the kitchen. Returns what was saved. Private mode keeps it in memory only. */
export function saveKitchen(kitchen, ls = globalThis.localStorage, at = new Date().toISOString()) {
  const k = kitchen ? normalizeKitchen({ ...kitchen, updatedAt: at }, at) : null;
  try {
    if (k) ls?.setItem(KITCHEN_KEY, JSON.stringify(k));
    else ls?.removeItem(KITCHEN_KEY);
  } catch { /* private mode */ }
  return k;
}

/**
 * The kitchen the confirm screens end on: the list as given, minus what was unticked, plus
 * what was ticked or typed under Add more (and the kit a way stands for).
 * conf: { removed: [names], have: [ids], typed: [{ text, id }] } as rung-quiz-ui's draft keeps it.
 */
export function confirmedItems(items, conf = {}) {
  const gone = new Set((conf.removed ?? []).map(norm));
  const kept = (items ?? []).map(cleanItem).filter((i) => i && !gone.has(norm(i.name)));
  const ids = [...new Set([...(conf.have ?? []), ...(conf.typed ?? []).filter((t) => t.id).map((t) => t.id)])];
  const added = [
    ...ids.filter((id) => kindOf(id)).map((id) => ({ name: labelFor(id), canonical: id, category: kindOf(id) === 'food' ? 'food' : 'cookware', source: 'confirm' })),
    ...(conf.typed ?? []).filter((t) => !t.id && cleanName(t.text)).map((t) => ({ name: cleanName(t.text), canonical: null, category: 'other', source: 'confirm' })),
  ];
  // An id already on the list under another name (Amul butter = butter) isn't added twice.
  const have = new Set(kept.map((i) => itemId(i)).filter(Boolean));
  return dedupe([...kept, ...added.filter((a) => !a.canonical || !have.has(a.canonical))]);
}

/** The vocabulary id (or open-ended x: id) an item stands for, or null. */
export function itemId(item, cache = {}) {
  if (item?.canonical && kindOf(item.canonical)) return item.canonical;
  const one = buildInventory([item], { cache });
  return one.matched[0]?.id ?? one.extras[0]?.id ?? matchName(item?.name ?? '') ?? null;
}

/** The kitchen's items split for the "My kitchen" sheet: { food: [{ item, id }], kit: [...] }. Utensils are assumed. */
export function kitchenGroups(items, cache = {}) {
  const out = { food: [], kit: [] };
  for (const item of items ?? []) {
    const id = itemId(item, cache);
    const kind = id && !id.startsWith('x:') ? kindOf(id) : null;
    if (kind === 'utensil') continue;
    const cat = String(item.category ?? '').toLowerCase();
    if (kind === 'appliance' || kind === 'cookware' || (!kind && /^(cookware|appliances?|equipment)$/.test(cat))) out.kit.push({ item, id });
    else out.food.push({ item, id });
  }
  return out;
}

/** Items on the list: food and cookware the person would count, not plates and spoons. */
export const countItems = (items, cache = {}) => { const g = kitchenGroups(items, cache); return g.food.length + g.kit.length; };

/** The kitchen with every item that stands for one of these ids taken out: { items, removed }. */
export function withoutIds(items, ids, cache = {}) {
  const drop = new Set(ids);
  const removed = [];
  const kept = [];
  for (const it of items ?? []) (drop.has(itemId(it, cache)) ? removed : kept).push(it);
  return { items: kept, removed };
}

/** Items added back, or new: once each. */
export const withItems = (items, more) => dedupe([...(items ?? []), ...(more ?? []).map(cleanItem).filter(Boolean)]);

// ── "Ran out of any of these?" (1.60.0) ─────────────────────────────────────
// After Cooked this: the things a dish uses up, as one-tap chips. Staples (rice, dal, oil,
// spices) last for weeks; these go in a meal or two.
export const USED_UP = Object.freeze(new Set([
  'eggs', 'paneer', 'bread', 'protein_bread', 'tortilla', 'milk', 'curd', 'cheese', 'cheese_slices', 'maggi',
  'banana', 'tomato', 'onion', 'spring_onion', 'capsicum', 'cucumber', 'spinach', 'lemon', 'green_chilli', 'potato', 'sprouts',
]));
const USED_UP_EXTRA = /mushroom|apple|mango|carrot|cabbage|pomegranate|broccoli|zucchini|coriander|hung.?curd|cream/;

/** What a cooked dish (a ranked item) may have used up: [{ id, label }], core ingredients only. */
export function ranOutChoices(ranked) {
  const out = [];
  for (const ing of ranked?.used?.ingredients ?? []) {
    const id = ing.id;
    if (!id || ing.optional || out.some((o) => o.id === id)) continue;
    if (USED_UP.has(id) || (id.startsWith('x:') && USED_UP_EXTRA.test(id))) out.push({ id, label: ing.label ?? labelFor(id) });
  }
  return out;
}

// ── Backup link (1.60.0) ────────────────────────────────────────────────────
// { v, i: [[name, canonical?]], w: ways, m: missingBasics } → packText. A 60-item kitchen is
// well under 1,000 characters. The link never reaches GitHub Pages (it's a fragment).

export async function encodeBackup(kitchen) {
  const k = normalizeKitchen(kitchen);
  if (!k) return null;
  const body = { v: VERSION, i: k.items.map((i) => (i.canonical ? [i.name, i.canonical] : [i.name])) };
  if (k.ways && Object.keys(k.ways).length) body.w = k.ways;
  if (k.missingBasics.length) body.m = k.missingBasics;
  return packText(JSON.stringify(body));
}

export async function decodeBackup(code, at = new Date().toISOString()) {
  const text = await unpackText(code);
  if (text == null) return null;
  try {
    const body = JSON.parse(text);
    if (!body || body.v !== VERSION || !Array.isArray(body.i)) return null;
    const items = body.i.map((r) => (Array.isArray(r) ? { name: r[0], canonical: r[1] ?? null, source: 'backup' } : null));
    return normalizeKitchen({ items, ways: body.w ?? null, missingBasics: body.m ?? [], updatedAt: at }, at);
  } catch {
    return null;
  }
}

export const backupLink = (code, page) => `${page}#restore=${code}`;

/** The backup code in a page's hash ("#restore=…"), or null. */
export function restoreCode(hash) {
  const m = /(?:^#|&)restore=([A-Za-z0-9_-]+)/.exec(String(hash ?? ''));
  return m ? m[1] : null;
}
