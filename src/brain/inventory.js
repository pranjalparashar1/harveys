// Turns the AI's free-form list of "things it saw" into the brain's inventory.
// Pure: no DOM, no network.

import { FOODS, EQUIPMENT, ASSUMED_BASICS } from './vocabulary.js';

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
 * @param {Array<{name: string, canonical?: string|null}>} items  what the AI (or the user) reported
 * @param {{missingBasics?: string[]}} [options]  basics the user says they don't have
 * @returns {{have: Set<string>, missingBasics: Set<string>, matched: Array<{name: string, id: string}>, unmatched: string[]}}
 */
export function buildInventory(items, options = {}) {
  const have = new Set();
  const matched = [];
  const unmatched = [];
  for (const item of items ?? []) {
    const name = typeof item === 'string' ? item : item?.name;
    const canonical = typeof item === 'object' ? item?.canonical : null;
    const id = canonical && ALL[canonical] ? canonical : matchName(name) ?? matchName(canonical);
    if (id) {
      have.add(id);
      matched.push({ name: name ?? id, id });
    } else if (name) {
      unmatched.push(name);
    }
  }
  return { have, missingBasics: new Set(options.missingBasics ?? []), matched, unmatched };
}
