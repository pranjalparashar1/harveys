// Turns the AI's free-form list of "things it saw" into the brain's inventory.
// Pure: no DOM, no network.

import { FOODS, EQUIPMENT, ASSUMED_BASICS } from './vocabulary.js';
import { profileOf, roleToken, ID_ROLES } from './pantry.js';

const ALL = { ...FOODS, ...EQUIPMENT, ...ASSUMED_BASICS };

/** Synonym index, longest phrase first so "peanut butter" beats "butter". */
const SYNONYMS = Object.entries(ALL)
  .flatMap(([id, entry]) => [id.replace(/_/g, ' '), ...(entry.synonyms ?? [])].map((s) => ({ id, phrase: s.toLowerCase() })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

function clean(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Maps a free-text name to a canonical id, or null. */
export function matchName(name) {
  const text = clean(name);
  if (!text) return null;
  for (const { id, phrase } of SYNONYMS) if (text === phrase) return id;
  const padded = ` ${text} `;
  for (const { id, phrase } of SYNONYMS) if (padded.includes(` ${phrase} `)) return id;
  return null;
}

/**
 * @param {Array<{name: string, canonical?: string|null, category?: string}>} items  what the AI (or the user) reported
 * @param {{missingBasics?: string[], cache?: object}} [options]  basics the user says they don't have;
 *   cache = flash-lite classifications (pantry.js), keyed by cleaned name
 * @returns {{have: Set<string>, missingBasics: Set<string>, matched: Array<{name: string, id: string}>,
 *   unmatched: string[], extras: object[], roles: Map<string, string[]>, labels: Map<string, string>, excluded: string[]}}
 *
 * Open-ended since 1.29.0: a name with no vocabulary id still joins the inventory as an
 * extra ('x:soy_sauce') with a profile, and its seasoning roles join `have` as 'role:umami'
 * etc., so a dish's "any acid" slot can use vinegar. `unmatched` now lists only the names
 * nothing could profile (worth a flash-lite classification). Non-veg items go to `excluded`.
 */
export function buildInventory(items, options = {}) {
  const have = new Set();
  const matched = [];
  const unmatched = [];
  const extras = [];
  const excluded = [];
  const roles = new Map();
  const labels = new Map();
  const addRoles = (list, id) => {
    for (const r of list ?? []) {
      have.add(roleToken(r));
      if (!roles.has(r)) roles.set(r, []);
      if (!roles.get(r).includes(id)) roles.get(r).push(id);
    }
  };
  for (const item of items ?? []) {
    const name = typeof item === 'string' ? item : item?.name;
    const canonical = typeof item === 'object' ? item?.canonical : null;
    const id = canonical && ALL[canonical] ? canonical : matchName(name) ?? matchName(canonical);
    if (id) {
      have.add(id);
      matched.push({ name: name ?? id, id });
      addRoles(ID_ROLES[id], id);
      continue;
    }
    if (!name) continue;
    const profile = profileOf(name, { category: item?.category, cache: options.cache ?? {} });
    if (!profile) continue;
    if (profile.diet === 'non_veg') { excluded.push(name); continue; }
    if (profile.source === 'unknown') unmatched.push(name);
    if (profile.as) {
      have.add(profile.as);
      matched.push({ name, id: profile.as });
    } else {
      have.add(profile.id);
      labels.set(profile.id, name);
    }
    extras.push(profile);
    addRoles(profile.roles, profile.as ?? profile.id);
  }
  return { have, missingBasics: new Set(options.missingBasics ?? []), matched, unmatched, extras, roles, labels, excluded };
}

/** Splits pasted text into item names: lines, commas, semicolons; drops bullets and numbering. */
export function parseItemList(text) {
  const seen = new Set();
  return String(text ?? '')
    .split(/[\n,;]+/)
    .map((s) => s.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
    .filter((s) => s.length > 1 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, 200);
}
