// Not a Marco dish any more (1.3.5 kept only the simplest meals). Kept here as
// the benchmark from pranjal's handwritten aglio olio: the golden tests check
// that the protein bread cheese toast still beats it on a tired weeknight.
export const AGLIO_OLIO = {
  id: 'pasta_aglio_olio_paneer',
  name: 'Fusilli aglio olio with air-fried paneer',
  kind: 'meal',
  equipment: ['stovetop', 'pot', 'pan', 'strainer', 'air_fryer'],
  utensils: ['knife', 'cutting_board', 'spatula', 'plate'],
  ingredients: [
    { id: 'pasta', amount: '80 g', prep: 'measure' },
    { id: 'paneer', amount: '100 g, cubed', prep: 'peel_chop' },
    { id: 'garlic', amount: '4 cloves, sliced', prep: 'peel_chop' },
    { id: 'oil', amount: '1 tbsp', prep: 'measure' },
    { id: 'salt', amount: 'to taste', prep: 'measure' },
    { id: 'chilli_flakes', amount: '1 tsp', prep: 'measure', optional: true },
  ],
  steps: [
    { text: 'Boil salted water and cook the fusilli for 10 minutes.', active: 2, passive: 10 },
    { text: 'Peel and slice the garlic.', active: 4 },
    { text: 'Cube the paneer and air-fry it at 190°C for 8 minutes.', active: 3, passive: 8 },
    { text: 'Gently fry the garlic and chilli flakes in oil until golden.', active: 4 },
    { text: 'Drain the pasta.', active: 1 },
    { text: 'Toss pasta, garlic oil and paneer together.', active: 2 },
  ],
  attention: 2,
  cleanup: { dishes: 6, greasy: 2 },
  macros: { protein: 33, kcal: 680, fiber: 4 },
  source: 'estimate',
};
