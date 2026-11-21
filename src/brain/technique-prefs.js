// Pierre technique preferences (1.27.0): ways pranjal makes a food because it tastes better,
// even when tired. Hand-written from the Marco prep quiz round 2 (data/prep-answers-round2-*.txt):
// each is a pick of the more careful way that friction alone can't explain (PR #63).
// These are Pierre's (quality), not Marco's (effort): a recipe uses `prefer`, and Marco never
// offers `over` as a cheaper version of the same dish. Pure data, no closures (ports to Swift).
//
// evidence: quiz ids where pranjal picked `prefer`; r-ids are the same pair at another energy.

export const TECHNIQUE_PREFS = Object.freeze([
  { food: 'rice', prefer: 'rinsed until the water runs clear', over: 'cooked unrinsed', evidence: ['p33', 'r12'] },
  { food: 'paneer', prefer: 'marinated 30 min before air-frying', over: 'spiced and cooked straight away', evidence: ['p32'] },
  { food: 'dal', prefer: 'tadka in ghee in a second pan, poured over', over: 'ghee stirred into the cooker', evidence: ['p51'] },
  { food: 'garlic', prefer: 'peeled fresh', over: 'peeled days ahead and kept in a jar', evidence: ['p42', 'r14'] },
  { food: 'besan', prefer: 'chilla batter whisked smooth and rested', over: 'lumpy batter straight on the pan', evidence: ['p55'] },
  // pranjal (21 Nov): the round 2 wording was unclear. What they want is the sauce cooked, not
  // cream stirred into drained pasta.
  { food: 'cream', prefer: 'sauce cooked first (oil, garlic, salt, then cream and cheese), pasta tossed in it', over: 'cream and cheese stirred into drained pasta', evidence: ['p47', 'r17'] },
  { food: 'onion', prefer: 'chopped by hand', over: 'pulsed in the blender', evidence: ['p57', 'r20'] },
  { food: 'banana', prefer: 'blended into the shake', over: 'eaten on the side', evidence: ['p53'] },
  { food: 'khichdi', prefer: 'rice and dal soaked first', over: 'unsoaked, more whistles', evidence: ['p59'] },
  { food: 'any', prefer: 'eaten from a bowl', over: 'eaten from the pot', evidence: ['p52', 'r19'] },
]);

/** Quiz ids whose pick was about taste, not effort: the prep fitter leaves them out. */
export const TASTE_PICKS = Object.freeze(TECHNIQUE_PREFS.flatMap((p) => p.evidence));

/** pranjal's preferred way with a food, or null. */
export function preferredTechnique(food) {
  return TECHNIQUE_PREFS.find((p) => p.food === food) ?? null;
}
