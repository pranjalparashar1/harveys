// Imports kitchens catalogued from video by another AI (1.29.0) into items buildInventory reads.
// Takes both shapes: the old fixed-id one ({have: [ids], other: [names]}) and the open one
// ({items: [{name, category}]} or plain names). Pure: no DOM, no network.

import { FOODS, EQUIPMENT, ASSUMED_BASICS, labelFor } from './vocabulary.js';

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
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* try the other shape */ }
  }
  return null;
}

/** True when pasted text looks like a catalogued-kitchen JSON rather than a plain list. */
export const looksLikeKitchenJson = (text) => /^\s*(```\w*\s*)?[[{]/.test(String(text ?? ''));
