// "Do you have a way to…?" (1.59.0, pranjal 26 Nov): testers know how they make eggs, not what
// their pan is called. So before the cookware check, Harvey asks how they do a few everyday
// things ("How do you usually scramble eggs?") and each way they pick stands for the kit the
// brain already ranks with: a pan, a pot, a kettle. The cookware check that follows shows that
// kit, so they can still untick it. Pure: no DOM, no network.
//
// A way with kit: [] (an egg boiler) is kept in the result but opens no dish yet: no recipe
// needs one. "I don't" (NONE) is a real answer: it clears the question's other picks.

export const NONE = 'none';

export const WAYS = Object.freeze([
  {
    id: 'boil_eggs',
    ask: 'Do you have a way to boil eggs?',
    opts: [
      { id: 'pot', label: 'A pot or patila', kit: ['saucepan'] },
      { id: 'cooker', label: 'Pressure cooker', kit: ['pressure_cooker'] },
      { id: 'kettle', label: 'In the kettle', kit: ['kettle'] },
      { id: 'egg_boiler', label: 'Egg boiler', kit: [] },
    ],
  },
  {
    id: 'scramble_eggs',
    ask: 'How do you usually scramble eggs?',
    opts: [
      { id: 'pan', label: 'Frying pan', kit: ['frying_pan'] },
      { id: 'kadai', label: 'Kadhai', kit: ['kadai'] },
      { id: 'tawa', label: 'Tawa', kit: ['tawa'] },
      { id: 'pot', label: 'In a pot', kit: ['saucepan'] },
      { id: 'microwave', label: 'Microwave', kit: ['microwave'] },
    ],
  },
  {
    id: 'toast_bread',
    ask: 'How do you toast bread?',
    opts: [
      { id: 'toaster', label: 'Toaster', kit: ['toaster'] },
      { id: 'tawa', label: 'On a tawa', kit: ['tawa'] },
      { id: 'pan', label: 'In a pan', kit: ['frying_pan'] },
      { id: 'sandwich_maker', label: 'Sandwich maker', kit: ['sandwich_maker'] },
      { id: 'air_fryer', label: 'Air fryer', kit: ['air_fryer'] },
      { id: 'oven', label: 'Oven or OTG', kit: ['oven'] },
    ],
  },
  {
    id: 'boil_water',
    ask: 'How do you boil water for chai or Maggi?',
    opts: [
      { id: 'kettle', label: 'Kettle', kit: ['kettle'] },
      { id: 'pot', label: 'A pot on the stove', kit: ['saucepan'] },
      { id: 'microwave', label: 'Microwave', kit: ['microwave'] },
    ],
  },
]);

const byId = new Map(WAYS.map((w) => [w.id, w]));
const optOf = (q, o) => byId.get(q)?.opts.find((x) => x.id === o) ?? null;

/**
 * Where the answers start: each way whose kit is all on the list is already picked, so a tester
 * whose list is right taps Next. A way with no kit (egg boiler) is never assumed.
 * have: a Set (or array) of the kitchen's equipment ids.
 */
export function waysFromKit(have) {
  const set = have instanceof Set ? have : new Set(have ?? []);
  return Object.fromEntries(WAYS.map((w) => [w.id, w.opts.filter((o) => o.kit.length && o.kit.every((k) => set.has(k))).map((o) => o.id)]));
}

/** The answers with one way tapped: on if it was off, off if it was on. NONE clears the rest. */
export function toggleWay(ways, q, o) {
  if (!byId.has(q) || (o !== NONE && !optOf(q, o))) return ways;
  const cur = ways?.[q] ?? [];
  let next;
  if (o === NONE) next = cur.includes(NONE) ? [] : [NONE];
  else next = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur.filter((x) => x !== NONE), o];
  return { ...(ways ?? {}), [q]: next };
}

/** Every equipment id the picked ways stand for, in WAYS order, once each. */
export function waysKit(ways) {
  const out = [];
  for (const w of WAYS) for (const o of ways?.[w.id] ?? []) for (const k of optOf(w.id, o)?.kit ?? []) if (!out.includes(k)) out.push(k);
  return out;
}

/** The answers as they go in a result: only known questions and ways, in order. */
export function waysOut(ways) {
  if (!ways) return null;
  return Object.fromEntries(WAYS.filter((w) => Array.isArray(ways[w.id])).map((w) => [w.id, ways[w.id].filter((o) => o === NONE || optOf(w.id, o))]));
}
