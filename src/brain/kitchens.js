// Imports kitchens catalogued from video by another AI (1.29.0) into items buildInventory reads.
// Takes both shapes: the old fixed-id one ({have: [ids], other: [names]}) and the open one
// ({items: [{name, category}]} or plain names). Pure: no DOM, no network.

import { FOODS, EQUIPMENT, ASSUMED_BASICS, labelFor } from './vocabulary.js';
import { profileOf } from './pantry.js';

const KNOWN = (id) => FOODS[id] || EQUIPMENT[id] || ASSUMED_BASICS[id];

/** @returns {Array<{kitchen: string, diet: string, notes: string, items: object[]}>} */
export function importKitchens(input) {
  const data = typeof input === 'string' ? parseLoose(input) : input;
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (Array.isArray(data.kitchens) ? data.kitchens : [data]) : [];
  return list.filter((k) => k && typeof k === 'object').map((k, i) => {
    const items = [];
    const seen = new Set();
    const push = (item) => {
      const key = String(item.canonical ?? item.name).toLowerCase();
      if (!item.name || seen.has(key)) return;
      seen.add(key);
      items.push({ canonical: null, category: 'other', source: 'import', ...item });
    };
    for (const id of Array.isArray(k.have) ? k.have : []) {
      if (typeof id !== 'string') continue;
      push(KNOWN(id) ? { name: labelFor(id), canonical: id, category: FOODS[id] ? 'food' : EQUIPMENT[id]?.kind ?? 'utensil' } : { name: id.replace(/_/g, ' ') });
    }
    for (const it of [...(Array.isArray(k.items) ? k.items : []), ...(Array.isArray(k.other) ? k.other : [])]) {
      if (typeof it === 'string' && it.trim()) push({ name: it.trim().slice(0, 80) });
      else if (it && typeof it.name === 'string' && it.name.trim()) push({ name: it.name.trim().slice(0, 80), category: typeof it.category === 'string' ? it.category : 'other' });
    }
    return {
      kitchen: typeof k.kitchen === 'string' && k.kitchen.trim() ? k.kitchen.trim() : `Kitchen ${i + 1}`,
      diet: typeof k.diet === 'string' ? k.diet : 'unknown',
      notes: typeof k.notes === 'string' ? k.notes : '',
      items,
    };
  }).filter((k) => k.items.length);
}

/** JSON, or JSON wrapped in prose or a code fence. */
function parseLoose(text) {
  const s = String(text ?? '');
  // Whichever bracket opens first: a single kitchen object holds an items array.
  const pairs = [['[', ']'], ['{', '}']].sort((x, y) => (s.indexOf(x[0]) + 1 || Infinity) - (s.indexOf(y[0]) + 1 || Infinity));
  for (const [open, close] of pairs) {
    const a = s.indexOf(open);
    const b = s.lastIndexOf(close);
    if (a < 0 || b <= a) continue;
    const body = s.slice(a, b + 1);
    try { return JSON.parse(body); } catch { /* try a repaired copy */ }
    try { return tidyKeys(JSON.parse(repairJson(body))); } catch { /* try the other shape */ }
  }
  return null;
}

/**
 * Mends JSON that a chat app or PDF hard-wrapped on copy: line breaks inside strings
 * ("cate\ngory", "induction\ncooktop"), smart quotes, trailing commas.
 */
export function repairJson(text) {
  const s = String(text ?? '').replace(/[\u201c\u201d\u201e\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'");
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') { out += c + (s[++i] ?? ''); continue; }
      if (c === '"') inString = false;
      if (c === '\n' || c === '\r' || c === '\t') { if (!out.endsWith(WRAP)) out += WRAP; continue; }
      out += c;
    } else {
      if (c === '"') inString = true;
      out += c;
    }
  }
  return out.replace(/,\s*([\]}])/g, '$1');
}

const WRAP = '\uE000'; // marks where a line break sat inside a string

// Keys never hold spaces, so a wrap mid-key ("cate|gory") just closes up.
function tidyKeys(v) {
  if (Array.isArray(v)) return v.map(tidyKeys);
  if (typeof v === 'string') return unwrap(v);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => {
    const key = k.replace(/[\s\uE000]+/g, '');
    // Categories are single tokens too ("nuts_seeds"), so a wrap in one closes up as well.
    return [key, key === 'category' && typeof x === 'string' ? x.replace(/[\s\uE000]+/g, '') : tidyKeys(x)];
  }));
}

// In a value a wrap was either a space ("induction|cooktop") or mid-word ("alm|onds").
// Close it up when a side is a tiny fragment, or when only the joined name is a known food.
function unwrap(text) {
  const parts = text.split(/\s*\uE000\s*/);
  let out = parts[0];
  for (const next of parts.slice(1)) {
    const left = out.match(/\S*$/)[0];
    const right = next.match(/^\S*/)[0];
    const known = (s) => profileOf(s)?.source !== 'unknown';
    const join = !/\s$/.test(out) && right && left && (left.length <= 2 || right.length <= 2 || (known(out + next) && !known(`${out} ${next}`)));
    out = join ? out + next : `${out} ${next}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** True when pasted text looks like a catalogued-kitchen JSON rather than a plain list. */
export const looksLikeKitchenJson = (text) => /^\s*(```\w*\s*)?[[{]/.test(String(text ?? ''));
