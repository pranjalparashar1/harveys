// Marco prep quiz (1.24.0): the same dish, two ways to make it, at a stated time and energy.
// Taste and protein stay (almost) the same inside a pair, so a pick shows what the effort
// costs: peeling, washing up, standing at the stove, waiting, soaking. Some pairs are
// lopsided or cross a rung on purpose (pranjal, 21 Nov: "lopsided pairs are fine").
// `taste: true` marks a pair where one way also changes the dish (skip the onion, ketchup for
// tomato): the fitter can leave those out with --no-taste.
//
// Export, one line per answer, the same "Send to Harvey's" path as the Pierre sheets:
//   #harveys marco-prep v1
//   p01 | a | 2026-11-21T15:00Z
// pick is a (left), b (right), either (equivalent) or neither (wouldn't cook it tonight).
// scripts/fit-prep.mjs fits Marco's θ from it; it never edits config.
// Pure: no DOM, no clock, no randomness.

import { FEATURES, featureVector, fitMarco } from '../brain/learn.js';

export const PREP_HEADER = '#harveys marco-prep v1';
export const PICKS = ['a', 'b', 'either', 'neither'];

/** Energy as the trainer's mood buckets (λ per mood is fitted from these). */
export const ENERGY = { fresh: 'fresh', okay: 'okay', tired: 'wiped out' };

// Every option is { name, how, c } where c holds Friction v2 counts (learn.js rawFeatures):
// tools, handsOn, waiting (min), prePrepMinutes, peels, cuts, steps, attention (0–3), cleanup.
// Unset counts are 0, except steps (2), attention (1) and cleanup (1).
const o = (name, how, c) => ({ name, how, c });

const PAIRS = [
  { id: 'p01', dish: 'Paneer cubes for a bowl', protein: 20, when: '7 PM', energy: 'okay',
    a: o('Pan-fried in ghee', 'Cube the paneer, fry in ghee, turn each side.', { tools: 2, handsOn: 7, cuts: 1, steps: 3, attention: 2, cleanup: 3.5 }),
    b: o('Air-fried', 'Cube the paneer, air-fry 10 min, shake once.', { tools: 2, handsOn: 2, waiting: 10, cuts: 1, steps: 3, attention: 0, cleanup: 2 }) },
  { id: 'p02', dish: 'Paneer bhurji', protein: 20, when: '9 PM', energy: 'tired',
    a: o('Paneer cubed', 'Cut the paneer into small cubes on a board.', { tools: 3, handsOn: 8, cuts: 1, steps: 3, attention: 2, cleanup: 3 }),
    b: o('Paneer crumbled by hand', 'Crumble the paneer straight into the pan.', { tools: 1, handsOn: 6, steps: 3, attention: 2, cleanup: 1.5 }) },
  { id: 'p03', dish: 'Protein oats', protein: 30, when: '8 AM', energy: 'okay',
    a: o('Microwave', 'Oats and milk in a bowl, 3 min, stir in whey.', { tools: 1, handsOn: 2, waiting: 3, steps: 2, attention: 1, cleanup: 1 }),
    b: o('Stovetop', 'Oats and milk in a pot, stir 6 min, stir in whey.', { tools: 2, handsOn: 7, steps: 2, attention: 2, cleanup: 2 }) },
  { id: 'p04', dish: 'Scrambled eggs', protein: 18, when: '10 PM', energy: 'tired',
    a: o('Eat from the pan', 'Scramble in butter, eat straight from the pan.', { tools: 1, handsOn: 4, steps: 2, attention: 2, cleanup: 1.5 }),
    b: o('Plated', 'Scramble in butter, plate it, wash the pan and plate.', { tools: 1, handsOn: 5, steps: 3, attention: 2, cleanup: 2.5 }) },
  { id: 'p05', dish: 'Boiled eggs', protein: 18, when: '7 PM', energy: 'okay',
    a: o('Pot on the stove', 'Eggs in water, boil 10 min, cool, peel.', { tools: 1, handsOn: 4, waiting: 12, steps: 3, attention: 1, cleanup: 1 }),
    b: o('Air fryer, no water', 'Eggs in the basket, 15 min, cool, peel.', { tools: 1, handsOn: 4, waiting: 15, steps: 3, attention: 0, cleanup: 0.5 }) },
  { id: 'p06', dish: 'Pasta for one', protein: 12, when: '8 PM', energy: 'okay',
    a: o('Boil and drain', 'Big pot of water, boil 10 min, drain in the strainer.', { tools: 2, handsOn: 3, waiting: 12, steps: 3, attention: 1, cleanup: 2 }),
    b: o('One pot, water cooks off', 'Just enough water, stir now and then until it’s absorbed.', { tools: 1, handsOn: 6, waiting: 6, steps: 2, attention: 2, cleanup: 1 }) },
  { id: 'p07', dish: 'Pasta aglio olio', protein: 12, when: '9 PM', energy: 'tired', taste: true,
    a: o('Fresh garlic, sliced', 'Peel and slice 4 cloves, fry gently in olive oil.', { tools: 3, handsOn: 9, waiting: 10, peels: 1, cuts: 1, steps: 4, attention: 2, cleanup: 3 }),
    b: o('No garlic', 'Chilli flakes and oregano in the warm oil instead.', { tools: 2, handsOn: 4, waiting: 10, steps: 3, attention: 1, cleanup: 2 }) },
  { id: 'p08', dish: 'Egg bhurji', protein: 18, when: '8 PM', energy: 'okay', taste: true,
    a: o('With onion', 'Peel and chop an onion, soften it, then the eggs.', { tools: 3, handsOn: 10, peels: 1, cuts: 1, steps: 4, attention: 2, cleanup: 3 }),
    b: o('Eggs only', 'Straight to the eggs in butter, chilli flakes on top.', { tools: 1, handsOn: 5, steps: 2, attention: 2, cleanup: 1.5 }) },
  { id: 'p09', dish: 'Dal', protein: 14, when: '8 PM', energy: 'okay',
    a: o('Pressure cooker', 'Dal and water, 3 whistles, walk away.', { tools: 1, handsOn: 3, waiting: 20, steps: 2, attention: 1, cleanup: 1.5 }),
    b: o('Open pot', 'Simmer 35 min, stir now and then, top up water.', { tools: 1, handsOn: 6, waiting: 35, steps: 2, attention: 2, cleanup: 1.5 }) },
  { id: 'p10', dish: 'Dal', protein: 14, when: '7 PM', energy: 'okay',
    a: o('Soaked first', 'Soak 30 min before, then 2 whistles.', { tools: 1, handsOn: 3, waiting: 14, prePrepMinutes: 30, steps: 3, attention: 1, cleanup: 1.5 }),
    b: o('No soak', 'Straight in, 4 whistles.', { tools: 1, handsOn: 3, waiting: 24, steps: 2, attention: 1, cleanup: 1.5 }) },
  { id: 'p11', dish: 'Rajma', protein: 15, when: 'Saturday 1 PM', energy: 'fresh',
    a: o('Soaked overnight', 'Soak the night before, then 6 whistles.', { tools: 1, handsOn: 4, waiting: 30, prePrepMinutes: 480, steps: 3, attention: 1, cleanup: 1.5 }),
    b: o('Hot soak, 1 hour', 'Boiling water over it, wait an hour, then 8 whistles.', { tools: 2, handsOn: 5, waiting: 40, prePrepMinutes: 60, steps: 4, attention: 1, cleanup: 2 }) },
  { id: 'p12', dish: 'Rice', protein: 4, when: '8 PM', energy: 'okay',
    a: o('Pressure cooker', 'Rice and water, 2 whistles, rest 10 min.', { tools: 1, handsOn: 2, waiting: 20, steps: 2, attention: 1, cleanup: 1 }),
    b: o('Pot, drained', 'Boil in lots of water 12 min, drain in the strainer.', { tools: 2, handsOn: 3, waiting: 14, steps: 3, attention: 1, cleanup: 2 }) },
  { id: 'p13', dish: 'Cheese toast', protein: 16, when: '10 PM', energy: 'tired',
    a: o('Air fryer', 'Cheese slice on protein bread, 5 min in the basket.', { tools: 1, handsOn: 1, waiting: 5, steps: 2, attention: 0, cleanup: 0.5 }),
    b: o('Pan, lid on', 'Butter the pan, toast it under a lid, watch it.', { tools: 2, handsOn: 5, steps: 2, attention: 2, cleanup: 2.5 }) },
  { id: 'p14', dish: 'Aloo chaat', protein: 6, when: '6 PM', energy: 'fresh',
    a: o('Potato pressure-cooked', '2 whistles, cool, peel, cube.', { tools: 2, handsOn: 6, waiting: 18, peels: 1, cuts: 2, steps: 4, attention: 1, cleanup: 2.5 }),
    b: o('Potato microwaved', 'Prick it, 6 min in the microwave, peel, cube.', { tools: 2, handsOn: 5, waiting: 6, peels: 1, cuts: 2, steps: 4, attention: 1, cleanup: 1.5 }) },
  { id: 'p15', dish: 'Soya chunks', protein: 25, when: '8 PM', energy: 'okay',
    a: o('Soaked in hot water', 'Hot water over them, 15 min, squeeze.', { tools: 1, handsOn: 3, prePrepMinutes: 15, steps: 3, attention: 0, cleanup: 1 }),
    b: o('Boiled', 'Boil 5 min in a pot, drain, squeeze.', { tools: 2, handsOn: 4, waiting: 5, steps: 3, attention: 1, cleanup: 2 }) },
  { id: 'p16', dish: 'Masala makhana', protein: 5, when: '9 PM', energy: 'tired',
    a: o('Air-fried', 'Toss in ghee and salt, 8 min in the basket.', { tools: 2, handsOn: 2, waiting: 8, steps: 2, attention: 0, cleanup: 1.5 }),
    b: o('Pan-roasted', 'Roast in ghee, keep stirring 6 min.', { tools: 1, handsOn: 6, steps: 2, attention: 2, cleanup: 2.5 }) },
  { id: 'p17', dish: 'Whey shake', protein: 25, when: '7 PM', energy: 'okay', taste: true,
    a: o('Shaker bottle', 'Whey and milk, shake.', { tools: 1, handsOn: 1, steps: 1, attention: 0, cleanup: 1 }),
    b: o('Blender, with banana', 'Peel a banana, blend with whey and milk.', { tools: 1, handsOn: 3, peels: 1, steps: 2, attention: 0, cleanup: 2 }) },
  { id: 'p18', dish: 'Pasta in tomato', protein: 12, when: '9 PM', energy: 'tired', taste: true,
    a: o('Fresh tomatoes', 'Chop 2 tomatoes, cook them down in olive oil.', { tools: 4, handsOn: 10, waiting: 10, cuts: 1, steps: 4, attention: 2, cleanup: 3.5 }),
    b: o('Ketchup', 'Toss the pasta with ketchup and oregano.', { tools: 2, handsOn: 3, waiting: 10, steps: 3, attention: 1, cleanup: 2 }) },
  { id: 'p19', dish: 'Egg fried rice', protein: 16, when: '8 PM', energy: 'okay',
    a: o('Rice cooked now', 'Pressure-cook rice, spread to cool, then fry with eggs.', { tools: 3, handsOn: 10, waiting: 20, steps: 5, attention: 3, cleanup: 4 }),
    b: o('Yesterday’s rice', 'Cold rice from the fridge straight into the pan with eggs.', { tools: 1, handsOn: 8, steps: 3, attention: 2, cleanup: 2 }) },
  { id: 'p20', dish: 'Omelette', protein: 18, when: '8 AM', energy: 'fresh',
    a: o('Pan', 'Whisk, pour into butter, fold.', { tools: 2, handsOn: 5, steps: 3, attention: 2, cleanup: 2.5 }),
    b: o('Air fryer, in a tin', 'Whisk, pour into a greased tin, 8 min.', { tools: 3, handsOn: 3, waiting: 8, steps: 3, attention: 0, cleanup: 3 }) },
  { id: 'p21', dish: 'Paneer bhurji', protein: 20, when: '8 PM', energy: 'okay', taste: true,
    a: o('Onion and tomato', 'Peel and chop onion, chop tomato, cook down, then paneer.', { tools: 3, handsOn: 14, peels: 1, cuts: 2, steps: 5, attention: 2, cleanup: 3.5 }),
    b: o('No chopping', 'Crumbled paneer in ghee, ketchup and chilli flakes.', { tools: 1, handsOn: 5, steps: 2, attention: 2, cleanup: 1.5 }) },
  { id: 'p22', dish: 'Maggi with egg', protein: 16, when: '11 PM', energy: 'tired',
    a: o('Egg cracked into the pot', 'Crack the egg into the Maggi for the last 2 min.', { tools: 1, handsOn: 3, waiting: 3, steps: 2, attention: 1, cleanup: 1 }),
    b: o('Egg fried on the side', 'Maggi in a pot, an egg fried in butter in a pan.', { tools: 2, handsOn: 6, waiting: 3, steps: 3, attention: 3, cleanup: 3.5 }) },
  { id: 'p23', dish: 'Chana chaat', protein: 15, when: '7 PM', energy: 'okay', taste: true,
    a: o('With coriander', 'Chop coriander on top.', { tools: 2, handsOn: 5, cuts: 1, steps: 3, attention: 0, cleanup: 2 }),
    b: o('Without', 'Lemon and chaat masala only.', { tools: 1, handsOn: 3, steps: 2, attention: 0, cleanup: 1 }) },
  { id: 'p24', dish: 'Paneer tikka', protein: 22, when: '8 PM', energy: 'okay',
    a: o('Air fryer', 'Cubes in curd and spice, 15 min, walk away.', { tools: 3, handsOn: 4, waiting: 15, cuts: 1, steps: 3, attention: 0, cleanup: 2.5 }),
    b: o('Pan', 'Cubes in curd and spice, fry 8 min, turning.', { tools: 3, handsOn: 9, cuts: 1, steps: 3, attention: 2, cleanup: 3.5 }) },
  { id: 'p25', dish: 'Curd and whey bowl', protein: 30, when: '9 PM', energy: 'tired',
    a: o('Stirred with a spoon', 'Whey into curd, stir hard.', { tools: 0, handsOn: 2, steps: 1, attention: 0, cleanup: 1 }),
    b: o('Blended smooth', 'Curd and whey in the blender.', { tools: 1, handsOn: 2, steps: 1, attention: 0, cleanup: 2 }) },
  { id: 'p26', dish: 'Besan chilla', protein: 14, when: 'Sunday 10 AM', energy: 'fresh',
    a: o('Three thin chillas', 'Spread thin, flip, three batches.', { tools: 3, handsOn: 14, steps: 4, attention: 3, cleanup: 3 }),
    b: o('One thick chilla, lid on', 'Pour it all in, lid on, flip once.', { tools: 3, handsOn: 5, waiting: 6, steps: 3, attention: 2, cleanup: 3 }) },
  { id: 'p27', dish: 'Khichdi', protein: 14, when: '8 PM', energy: 'okay',
    a: o('Pressure cooker, one pot', 'Rice, dal, ghee, water, 3 whistles.', { tools: 1, handsOn: 3, waiting: 20, steps: 2, attention: 1, cleanup: 1.5 }),
    b: o('Rice and dal apart', 'Rice in one pot, dal in the cooker, mix.', { tools: 2, handsOn: 5, waiting: 20, steps: 4, attention: 1, cleanup: 3 }) },
  { id: 'p28', dish: 'Kala chana', protein: 15, when: '7 PM', energy: 'okay',
    a: o('Boiled on Sunday', 'A batch from the fridge, warmed with salt and lemon.', { tools: 1, handsOn: 2, waiting: 2, steps: 2, attention: 0, cleanup: 1 }),
    b: o('Soaked last night, cooked now', '6 whistles in the cooker, then season.', { tools: 1, handsOn: 4, waiting: 30, prePrepMinutes: 480, steps: 3, attention: 1, cleanup: 1.5 }) },
  { id: 'p29', dish: 'Egg sandwich', protein: 20, when: '9 PM', energy: 'tired',
    a: o('Egg mayo', 'Boil 2 eggs, peel, mash with mayo, in toast.', { tools: 2, handsOn: 6, waiting: 12, steps: 4, attention: 1, cleanup: 2 }),
    b: o('Fried egg', 'Fry 2 eggs in butter, into toast.', { tools: 1, handsOn: 5, steps: 3, attention: 2, cleanup: 1.5 }) },
  { id: 'p30', dish: 'Soya chunks, chilli style', protein: 25, when: 'Saturday 7 PM', energy: 'fresh', taste: true,
    a: o('Onion and capsicum', 'Peel and slice onion, slice capsicum, sauté, toss in sauces.', { tools: 3, handsOn: 14, peels: 1, cuts: 2, prePrepMinutes: 15, steps: 5, attention: 2, cleanup: 3.5 }),
    b: o('Just the chunks', 'Squeezed chunks sautéed, tossed in chilli sauce and ketchup.', { tools: 1, handsOn: 6, prePrepMinutes: 15, steps: 3, attention: 2, cleanup: 2 }) },
];

// The same choice again at the other end of the energy scale: these pin λ per mood.
const REPEATS = [
  ['p01', 'Saturday 1 PM', 'fresh'], ['p03', '10 PM', 'tired'], ['p06', '10 PM', 'tired'], ['p08', '10 PM', 'tired'],
  ['p09', '10 PM', 'tired'], ['p13', 'Sunday 11 AM', 'fresh'], ['p16', 'Saturday 4 PM', 'fresh'], ['p19', '10:30 PM', 'tired'],
  ['p21', '10:30 PM', 'tired'], ['p24', '10 PM', 'tired'],
];

// Round 2 (1.26.0): more dishes, more prep steps (grating, marinating, kneading, rinsing,
// weighing, boiling milk, batches, mashing, garnishes, batch cooking).
const PAIRS_2 = [
  { id: 'p31', dish: 'Paneer for a sandwich', protein: 20, when: '8 PM', energy: 'okay',
    a: o('Grated', 'Grate the paneer, mix with salt and pepper.', { tools: 2, handsOn: 5, steps: 2, attention: 0, cleanup: 2 }),
    b: o('Sliced', 'Two thick slices straight from the block.', { tools: 1, handsOn: 2, cuts: 1, steps: 1, attention: 0, cleanup: 1 }) },
  { id: 'p32', dish: 'Paneer tikka', protein: 22, when: 'Saturday 6 PM', energy: 'fresh',
    a: o('Marinated 30 min', 'Curd and spice on the cubes, rest 30 min, air-fry.', { tools: 3, handsOn: 5, waiting: 15, prePrepMinutes: 30, cuts: 1, steps: 4, attention: 0, cleanup: 2.5 }),
    b: o('Straight in', 'Curd and spice on the cubes, air-fry now.', { tools: 3, handsOn: 4, waiting: 15, cuts: 1, steps: 3, attention: 0, cleanup: 2.5 }) },
  { id: 'p33', dish: 'Rice', protein: 4, when: '8 PM', energy: 'okay',
    a: o('Rinsed three times', 'Rinse until the water runs clear, then cook.', { tools: 2, handsOn: 5, waiting: 20, steps: 3, attention: 1, cleanup: 1.5 }),
    b: o('Not rinsed', 'Straight into the cooker.', { tools: 1, handsOn: 2, waiting: 20, steps: 2, attention: 1, cleanup: 1 }) },
  { id: 'p34', dish: 'Protein oats', protein: 30, when: '8 AM', energy: 'okay',
    a: o('Weighed on the scale', '50 g oats, 30 g whey, 200 ml milk, weighed.', { tools: 2, handsOn: 4, waiting: 3, steps: 3, attention: 1, cleanup: 1.5 }),
    b: o('Eyeballed', 'A handful of oats, a scoop of whey, milk to cover.', { tools: 1, handsOn: 2, waiting: 3, steps: 2, attention: 1, cleanup: 1 }) },
  { id: 'p35', dish: 'Roti with dal', protein: 16, when: 'Sunday 1 PM', energy: 'fresh',
    a: o('Fresh rotis', 'Knead atta, roll and cook 4 rotis on the tawa.', { tools: 4, handsOn: 25, steps: 5, attention: 3, cleanup: 4 }),
    b: o('Rice instead', 'Rice from the cooker with the dal.', { tools: 1, handsOn: 2, waiting: 20, steps: 2, attention: 1, cleanup: 1 }), taste: true },
  { id: 'p36', dish: 'Hot chocolate protein', protein: 25, when: '10 PM', energy: 'tired',
    a: o('Milk boiled on the stove', 'Heat milk in a pot, whisk in cocoa and whey.', { tools: 2, handsOn: 5, waiting: 4, steps: 3, attention: 2, cleanup: 2 }),
    b: o('Microwaved mug', 'Milk in a mug, 2 min, stir in cocoa and whey.', { tools: 1, handsOn: 2, waiting: 2, steps: 2, attention: 0, cleanup: 1 }) },
  { id: 'p37', dish: 'Poha', protein: 8, when: '9 AM', energy: 'okay',
    a: o('Rinsed in a strainer', 'Rinse the poha in the strainer, drain 5 min.', { tools: 3, handsOn: 10, waiting: 5, peels: 1, cuts: 1, steps: 5, attention: 2, cleanup: 3.5 }),
    b: o('Soaked in a bowl', 'Soak 2 min in a bowl, squeeze out by hand.', { tools: 3, handsOn: 11, waiting: 2, peels: 1, cuts: 1, steps: 5, attention: 2, cleanup: 3.5 }) },
  { id: 'p38', dish: 'Masala chickpeas', protein: 15, when: '8 PM', energy: 'okay',
    a: o('Tempered in oil', 'Heat oil, crackle chilli flakes, toss the boiled chickpeas.', { tools: 2, handsOn: 6, steps: 3, attention: 2, cleanup: 2.5 }),
    b: o('Tossed cold', 'Boiled chickpeas, lemon, chaat masala in a bowl.', { tools: 1, handsOn: 2, steps: 2, attention: 0, cleanup: 1 }), taste: true },
  { id: 'p39', dish: 'Air-fried potato', protein: 4, when: '9 PM', energy: 'tired',
    a: o('Wedges, peeled', 'Peel, cut wedges, oil and salt, 18 min.', { tools: 3, handsOn: 7, waiting: 18, peels: 1, cuts: 1, steps: 3, attention: 0, cleanup: 2.5 }),
    b: o('Wedges, skin on', 'Scrub, cut wedges, oil and salt, 18 min.', { tools: 3, handsOn: 5, waiting: 18, cuts: 1, steps: 3, attention: 0, cleanup: 2.5 }) },
  { id: 'p40', dish: 'Aloo paratha night', protein: 10, when: 'Sunday 7 PM', energy: 'fresh',
    a: o('Potato mashed by hand', 'Mash boiled potato with a fork, season, stuff.', { tools: 4, handsOn: 30, waiting: 15, peels: 1, steps: 6, attention: 3, cleanup: 4.5 }),
    b: o('Cheese toast instead', 'Cheese slices on protein bread in the air fryer.', { tools: 1, handsOn: 1, waiting: 5, steps: 2, attention: 0, cleanup: 0.5 }), taste: true },
  { id: 'p41', dish: 'Raita', protein: 6, when: '8 PM', energy: 'okay',
    a: o('Grated cucumber', 'Grate a cucumber, squeeze, stir into curd.', { tools: 2, handsOn: 6, steps: 3, attention: 0, cleanup: 2 }),
    b: o('Chopped cucumber', 'Dice a cucumber into the curd.', { tools: 2, handsOn: 4, cuts: 1, steps: 2, attention: 0, cleanup: 2 }) },
  { id: 'p42', dish: 'Garlic for aglio olio', protein: 12, when: '8 PM', energy: 'okay',
    a: o('Peeled now', 'Peel and slice 4 cloves.', { tools: 2, handsOn: 6, peels: 1, cuts: 1, steps: 2, attention: 0, cleanup: 1.5 }),
    b: o('Peeled on Sunday', 'A jar of cloves you peeled at the weekend, sliced.', { tools: 2, handsOn: 3, cuts: 1, steps: 2, attention: 0, cleanup: 1.5 }) },
  { id: 'p43', dish: 'Boiled eggs for the week', protein: 18, when: 'Sunday 11 AM', energy: 'fresh',
    a: o('Boil 10 on Sunday', 'Boil a batch, peel 2 each night from the fridge.', { tools: 1, handsOn: 2, steps: 2, attention: 0, cleanup: 0.5 }),
    b: o('Boil 2 each night', 'Boil, cool and peel 2 eggs every night.', { tools: 1, handsOn: 4, waiting: 12, steps: 3, attention: 1, cleanup: 1 }) },
  { id: 'p44', dish: 'Egg bhurji', protein: 18, when: '10 PM', energy: 'tired',
    a: o('Whisked in a bowl first', 'Whisk the eggs in a bowl, pour into the pan.', { tools: 2, handsOn: 5, steps: 3, attention: 2, cleanup: 2.5 }),
    b: o('Cracked into the pan', 'Crack straight into the butter, scramble there.', { tools: 1, handsOn: 4, steps: 2, attention: 2, cleanup: 1.5 }) },
  { id: 'p45', dish: 'Tawa paneer sandwich', protein: 22, when: '9 PM', energy: 'tired',
    a: o('Pan, weighed down', 'Butter both sides, press with a plate, flip.', { tools: 2, handsOn: 7, steps: 3, attention: 2, cleanup: 2.5 }),
    b: o('Air fryer', 'Assemble, 6 min in the basket.', { tools: 1, handsOn: 3, waiting: 6, steps: 2, attention: 0, cleanup: 1 }) },
  { id: 'p46', dish: 'Masala makhana', protein: 5, when: 'Saturday 5 PM', energy: 'fresh',
    a: o('One big batch', 'Roast 200 g, keep the rest in a jar for the week.', { tools: 2, handsOn: 6, waiting: 10, steps: 3, attention: 1, cleanup: 2 }),
    b: o('A bowl each time', 'Roast one bowl now, again next time.', { tools: 2, handsOn: 3, waiting: 8, steps: 2, attention: 0, cleanup: 1.5 }) },
  { id: 'p47', dish: 'Pasta in cream', protein: 14, when: '8 PM', energy: 'okay',
    a: o('Sauce in a second pan', 'Warm cream and cheese in a pan, toss the pasta in.', { tools: 3, handsOn: 6, waiting: 12, steps: 4, attention: 2, cleanup: 3.5 }),
    b: o('Back in the pot', 'Drain, return to the pot, stir cream and cheese in.', { tools: 2, handsOn: 4, waiting: 12, steps: 3, attention: 1, cleanup: 2 }) },
  { id: 'p48', dish: 'Chilli soya', protein: 25, when: '8 PM', energy: 'okay',
    a: o('Chunks fried in batches', 'Fry the chunks in two batches so they crisp.', { tools: 2, handsOn: 12, prePrepMinutes: 15, steps: 4, attention: 3, cleanup: 3 }),
    b: o('All at once', 'Everything in one go, toss in the sauces.', { tools: 2, handsOn: 7, prePrepMinutes: 15, steps: 3, attention: 2, cleanup: 3 }) },
  { id: 'p49', dish: 'Egg fried rice', protein: 16, when: '9 PM', energy: 'tired',
    a: o('Eggs scrambled apart', 'Scramble eggs, set aside, fry rice, combine.', { tools: 2, handsOn: 9, steps: 4, attention: 3, cleanup: 3 }),
    b: o('Eggs pushed to the side', 'Rice in, push aside, crack eggs into the gap.', { tools: 1, handsOn: 7, steps: 3, attention: 2, cleanup: 2 }) },
  { id: 'p50', dish: 'Aloo chaat', protein: 6, when: '7 PM', energy: 'okay', taste: true,
    a: o('With onion and tomato', 'Peel and chop onion, chop tomato, coriander.', { tools: 3, handsOn: 12, waiting: 6, peels: 2, cuts: 3, steps: 5, attention: 1, cleanup: 2.5 }),
    b: o('Potato only', 'Potato cubes, lemon, chaat masala.', { tools: 2, handsOn: 5, waiting: 6, peels: 1, cuts: 1, steps: 3, attention: 1, cleanup: 1.5 }) },
  { id: 'p51', dish: 'Dal', protein: 14, when: '7 PM', energy: 'okay', taste: true,
    a: o('Tadka in ghee', 'Second pan: ghee, chilli flakes, poured over.', { tools: 2, handsOn: 6, waiting: 20, steps: 3, attention: 2, cleanup: 2.5 }),
    b: o('Ghee stirred in', 'A spoon of ghee stirred into the cooker.', { tools: 1, handsOn: 3, waiting: 20, steps: 2, attention: 1, cleanup: 1.5 }) },
  { id: 'p52', dish: 'Cheese Maggi', protein: 10, when: '11 PM', energy: 'tired',
    a: o('In a bowl to eat', 'Cook, pour into a bowl.', { tools: 1, handsOn: 3, waiting: 3, steps: 2, attention: 1, cleanup: 2 }),
    b: o('From the pot', 'Cook, eat straight from the pot.', { tools: 1, handsOn: 3, waiting: 3, steps: 2, attention: 1, cleanup: 1 }) },
  { id: 'p53', dish: 'Whey shake', protein: 25, when: '6 PM', energy: 'fresh',
    a: o('Banana sliced in', 'Peel and slice a banana into the blender.', { tools: 1, handsOn: 3, peels: 1, cuts: 1, steps: 2, attention: 0, cleanup: 2 }),
    b: o('Banana on the side', 'Shake whey and milk, eat the banana as it is.', { tools: 1, handsOn: 1, steps: 1, attention: 0, cleanup: 1 }) },
  { id: 'p54', dish: 'Rajma', protein: 15, when: 'Sunday 12 PM', energy: 'fresh',
    a: o('Cook for 3 days', 'One big cooker, three days in the fridge.', { tools: 1, handsOn: 6, waiting: 35, prePrepMinutes: 480, steps: 3, attention: 1, cleanup: 2 }),
    b: o('Cook for today', 'A small cooker, today only.', { tools: 1, handsOn: 4, waiting: 30, prePrepMinutes: 480, steps: 3, attention: 1, cleanup: 1.5 }) },
  { id: 'p55', dish: 'Besan chilla', protein: 14, when: '9 PM', energy: 'tired',
    a: o('Batter whisked smooth', 'Whisk out every lump, rest 10 min.', { tools: 3, handsOn: 9, prePrepMinutes: 10, steps: 4, attention: 2, cleanup: 3 }),
    b: o('Lumpy is fine', 'Quick stir, straight on the pan.', { tools: 3, handsOn: 6, steps: 3, attention: 2, cleanup: 3 }) },
  { id: 'p56', dish: 'Curd rice', protein: 10, when: '10 PM', energy: 'tired',
    a: o('Rice cooked fresh', 'Cook rice, cool, mix with curd.', { tools: 1, handsOn: 3, waiting: 30, steps: 3, attention: 1, cleanup: 1.5 }),
    b: o('Leftover rice', 'Cold rice from the fridge, mix with curd.', { tools: 0, handsOn: 2, steps: 1, attention: 0, cleanup: 1 }) },
  { id: 'p57', dish: 'Paneer bhurji', protein: 20, when: '8 PM', energy: 'okay',
    a: o('Onion chopped by hand', 'Peel and chop an onion fine on the board.', { tools: 3, handsOn: 12, peels: 1, cuts: 1, steps: 4, attention: 2, cleanup: 3 }),
    b: o('Onion pulsed in the blender', 'Peel, quarter, pulse 3 times.', { tools: 3, handsOn: 9, peels: 1, cuts: 1, steps: 4, attention: 2, cleanup: 3.5 }) },
  { id: 'p58', dish: 'Scrambled eggs on toast', protein: 22, when: '8 AM', energy: 'okay',
    a: o('Toast in the pan first', 'Toast the bread in the pan, then the eggs.', { tools: 1, handsOn: 6, steps: 3, attention: 2, cleanup: 1.5 }),
    b: o('Toast in the air fryer', 'Bread in the air fryer while you scramble.', { tools: 2, handsOn: 5, waiting: 4, steps: 3, attention: 3, cleanup: 2 }) },
  { id: 'p59', dish: 'Khichdi', protein: 14, when: '9 PM', energy: 'tired',
    a: o('Dal and rice soaked', 'Soak 30 min, then 2 whistles.', { tools: 1, handsOn: 3, waiting: 14, prePrepMinutes: 30, steps: 3, attention: 1, cleanup: 1.5 }),
    b: o('No soak, more whistles', 'Straight in, 4 whistles.', { tools: 1, handsOn: 3, waiting: 24, steps: 2, attention: 1, cleanup: 1.5 }) },
  { id: 'p60', dish: 'Mint for raita', protein: 6, when: '7 PM', energy: 'okay', taste: true,
    a: o('Mint chopped fine', 'Pick and chop a handful of mint.', { tools: 2, handsOn: 5, cuts: 1, steps: 2, attention: 0, cleanup: 2 }),
    b: o('Mint torn by hand', 'Tear a few leaves straight in.', { tools: 0, handsOn: 2, steps: 1, attention: 0, cleanup: 1 }) },
];

const REPEATS_2 = [
  ['p31', '10 PM', 'tired'], ['p33', '10 PM', 'tired'], ['p36', 'Saturday 5 PM', 'fresh'], ['p42', '10 PM', 'tired'],
  ['p44', 'Sunday 10 AM', 'fresh'], ['p45', 'Saturday 1 PM', 'fresh'], ['p47', '10:30 PM', 'tired'], ['p49', 'Saturday 7 PM', 'fresh'],
  ['p52', 'Sunday 2 PM', 'fresh'], ['p57', '10 PM', 'tired'],
];

const DEFAULTS = { tools: 0, handsOn: 0, waiting: 0, prePrepMinutes: 0, peels: 0, cuts: 0, steps: 2, attention: 1, cleanup: 1 };
const withDefaults = (opt, protein) => ({ ...opt, raw: { ...DEFAULTS, ...opt.c, protein } });

/** One round: pairs plus repeats at the other energy, interleaved; every 4th question held out. */
function buildRound(pairs, repeats, firstRepeat, round) {
  const all = [
    ...pairs,
    ...repeats.map(([id, when, energy], k) => ({ ...pairs.find((p) => p.id === id), id: `r${String(firstRepeat + k).padStart(2, '0')}`, of: id, when, energy })),
  ];
  // A fixed interleave so repeats don't sit next to their originals.
  const order = all.map((p, i) => [p, (i * 13) % all.length]).sort((x, y) => x[1] - y[1]).map(([p]) => p);
  return Object.freeze(order.map((p, i) => Object.freeze({
    ...p, round, n: i + 1, holdout: i % 4 === 3, a: withDefaults(p.a, p.protein), b: withDefaults(p.b, p.protein),
  })));
}

/** Round 1, in the order it is shown. */
export const PREP_QUIZ = buildRound(PAIRS, REPEATS, 1, 1);
export const PREP_ROUNDS = Object.freeze({ 1: PREP_QUIZ, 2: buildRound(PAIRS_2, REPEATS_2, 11, 2) });
/** Every question of every round: what the fitter reads answers against. */
export const PREP_ALL = Object.freeze(Object.values(PREP_ROUNDS).flat());

/** Plain words for an option's effort, for the card. */
export function prepFacts(opt) {
  const r = opt.raw;
  return [
    `${r.handsOn} min hands-on`,
    r.waiting > 0 ? `${r.waiting} min waiting` : null,
    r.prePrepMinutes >= 480 ? 'soak overnight' : r.prePrepMinutes >= 60 ? `soak ${r.prePrepMinutes / 60} h` : r.prePrepMinutes > 0 ? `soak ${r.prePrepMinutes} min` : null,
    r.peels > 0 ? `${r.peels} to peel` : null,
    r.cuts > 0 ? `${r.cuts} to cut` : null,
    r.peels + r.cuts === 0 ? 'no knife' : null,
    ['walk away', 'check in', 'stay close', 'juggling'][r.attention],
    `${Math.ceil(r.cleanup)} to wash`,
  ].filter(Boolean);
}

// ── Export ──────────────────────────────────────────────────────────────────

const minute = (at) => (typeof at === 'string' && at.length > 17 ? `${at.slice(0, 16)}Z` : at ?? '-');

/** answers: { [questionId]: { pick, at } } → the export text. */
export function encodePrep(answers, quiz = PREP_QUIZ) {
  const lines = [PREP_HEADER];
  for (const q of quiz) {
    const a = answers[q.id];
    if (a && PICKS.includes(a.pick)) lines.push(`${q.id} | ${a.pick} | ${minute(a.at)}`);
  }
  return lines.join('\n');
}

/** The export text (or a GitHub issue body around it) → answers. Unknown lines are ignored. */
export function parsePrep(text) {
  const answers = {};
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/^```.*$/, '').trim();
    const m = /^([pr]\d{2})\s*\|\s*(a|b|either|neither)\s*(?:\|\s*(\S+))?$/.exec(line);
    if (m) answers[m[1]] = { pick: m[2], at: m[3] && m[3] !== '-' ? m[3] : null };
  }
  return answers;
}

// ── Fitting ─────────────────────────────────────────────────────────────────

/** Answers → fitMarco choices. Pierre is held equal (1) inside a pair: same dish. */
export function prepChoices(answers, { quiz = PREP_ALL, noTaste = false } = {}) {
  const out = [];
  for (const q of quiz) {
    const a = answers[q.id];
    if (!a || !PICKS.includes(a.pick) || (noTaste && q.taste)) continue;
    out.push({ id: q.id, holdout: q.holdout, xa: featureVector(q.a.raw, 1), xb: featureVector(q.b.raw, 1), pick: a.pick, mood: q.energy });
  }
  return out;
}

/**
 * Fits on the training questions, scores the held-out ones, then fits on everything for the
 * weights to ship. `current` (config.frictionTheta) is the prior the fit is pulled toward.
 */
export function fitPrep(answers, { current = {}, noTaste = false, quiz = PREP_ALL } = {}) {
  const choices = prepChoices(answers, { quiz, noTaste });
  const prior = FEATURES.map((f) => (f.payoff ? f.prior : current[f.key] ?? f.prior));
  const strip = ({ xa, xb, pick, mood }) => ({ xa, xb, pick, mood });
  const train = choices.filter((c) => !c.holdout);
  const held = choices.filter((c) => c.holdout);
  const trainFit = fitMarco(train.map(strip), { prior });
  const lam = (m) => trainFit.lambdas[m] ?? 1;
  const util = (x, m) => x.reduce((s, v, j) => s + v * trainFit.theta[j] * (FEATURES[j].payoff ? 1 : lam(m)), 0);
  // A held-out pick counts as predicted if Marco prefers the same side; "either" if within the gap.
  const predicted = held.filter((c) => {
    const d = util(c.xa, c.mood) - util(c.xb, c.mood);
    if (c.pick === 'either') return Math.abs(d) < 0.2;
    if (c.pick === 'neither') return Math.max(util(c.xa, c.mood), util(c.xb, c.mood)) < trainFit.outside;
    return c.pick === 'a' ? d >= 0 : d < 0;
  }).length;
  const fit = fitMarco(choices.map(strip), { prior });
  // Protein and Pierre don't vary inside a pair, so θ_protein barely moves; keep friction in
  // the config's units (protein at its prior) by not rescaling.
  const raw = Object.fromEntries(FEATURES.map((f, j) => [f.key, +fit.theta[j].toFixed(3)]));
  const frictionTheta = Object.fromEntries(FEATURES.filter((f) => !f.payoff).map((f) => [f.key, Math.min(0, raw[f.key])]));
  const diff = FEATURES.filter((f) => !f.payoff).map((f) => ({ key: f.key, now: current[f.key] ?? f.prior, fitted: raw[f.key], proposed: frictionTheta[f.key] }));
  return {
    answered: choices.length, train: train.length, held: held.length, heldHits: predicted,
    hits: fit.hits, looHits: fit.looHits, priorHits: fit.priorHits, lambdas: fit.lambdas, theta: raw, frictionTheta, diff,
  };
}
