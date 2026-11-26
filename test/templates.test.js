// Open-slot templates (1.54.0): the catalogue opens to whatever the kitchen has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE } from '../src/brain/catalogue.js';
import { buildInventory } from '../src/brain/inventory.js';
import { importKitchens } from '../src/brain/kitchens.js';
import { rank, orderRung, isSweet } from '../src/brain/ranker.js';
import { expandTemplates, variantsOf, NEVER_MICROWAVE, NEVER_SWAP } from '../src/brain/templates.js';
import { buildRungQuiz, stratify, DECK_MAX } from '../src/brain/rung-quiz.js';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';

const kitchens = importKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));
const inv = (names) => buildInventory(names.map((name) => ({ name })));

test('templates: mushrooms open paneer slots, cooked the same way; tofu opens nothing', () => {
  const have = inv(['tofu', 'mushrooms', 'air fryer', 'curd', 'garam masala', 'capsicum']);
  const all = expandTemplates(CATALOGUE, have);
  const ids = all.map((m) => m.id);
  assert.ok(ids.includes('airfryer_paneer_tikka~mushroom'));
  const mush = all.find((m) => m.id === 'airfryer_paneer_tikka~mushroom');
  assert.ok(mush.steps.every((s) => !/paneer/i.test(s.text)));
  // 1.56.0 (pranjal, 26 Nov): tofu is dropped entirely, so it fills no slot and names no dish.
  assert.ok(all.every((m) => !/tofu/i.test(`${m.id} ${m.name} ${m.steps.map((s) => s.text).join(' ')}`)), 'no tofu dish');
  assert.ok(all.every((m) => !m.template?.proxy), 'no stand-ins left');
  const r = rank({ inventory: have, targets: { protein: 30, kcal: 600 }, catalogue: all });
  assert.ok(r.ranked.some((x) => x.meal.id === 'airfryer_paneer_tikka~mushroom'));
  assert.ok(!kitchens.some((k) => k.items.some((i) => /tofu/i.test(i.name))), 'no persona kitchen lists tofu');
});

test('templates: soya chunks are never swapped into or out of a dish (pranjal, 26 Nov)', () => {
  assert.ok(NEVER_SWAP.has('soya_chunks'));
  const extra = ['soya chunks', 'paneer', 'mushrooms', 'potato', 'air fryer', 'pasta', 'rice', 'curd', 'onion', 'capsicum', 'tomato'];
  const kits = [...kitchens.map((k) => buildInventory(k.items)), inv(extra)];
  for (const have of kits) {
    for (const m of expandTemplates(CATALOGUE, have).filter((x) => x.template)) {
      const src = CATALOGUE.find((c) => c.id === m.template.from);
      const soya = (d) => d.parts.some((p) => p.id === 'soya_chunks');
      // A soya dish opens no swap (an add-on vegetable may still join it), and no swap brings soya in.
      if (m.template.swap) assert.ok(!soya(src) && !soya(m), m.id);
      if (m.template.add) assert.equal(soya(m), soya(src), m.id);
    }
  }
});

test('templates: every variant keeps pranjal’s rules and only uses ways Pierre has rated', () => {
  for (const k of kitchens) {
    for (const m of expandTemplates(CATALOGUE, buildInventory(k.items)).filter((x) => x.template)) {
      for (const p of m.parts) {
        if (p.technique === 'microwaved') assert.ok(!NEVER_MICROWAVE.has(p.id), `${m.id} microwaves ${p.id}`);
        assert.ok(p.technique ? PIERRE_RAW.tech[`${p.id}@${p.technique}`] || CATALOGUE.find((c) => c.id === m.template.from).parts.some((q) => q.id === p.id && q.technique === p.technique) : PIERRE_RAW.foods[p.id] || CATALOGUE.find((c) => c.id === m.template.from).parts.some((q) => q.id === p.id), `${m.id}: ${p.id}@${p.technique}`);
      }
      // Tadka fats are never swapped: the fat ingredients are the template's own.
      const src = CATALOGUE.find((c) => c.id === m.template.from);
      const fats = (ms) => ms.ingredients.filter((i) => (i.anyOf ?? [i.id]).some((x) => ['oil', 'ghee', 'butter'].includes(x))).map((i) => JSON.stringify(i.anyOf ?? [i.id]));
      assert.deepEqual(fats(m), fats(src), m.id);
    }
  }
});

test('templates: a knife-free dish stays knife-free, and names are unique', () => {
  for (const k of kitchens) {
    const all = expandTemplates(CATALOGUE, buildInventory(k.items));
    for (const m of all.filter((x) => x.template)) {
      const src = CATALOGUE.find((c) => c.id === m.template.from);
      const knife = (d) => d.ingredients.some((i) => ['cut', 'peel_chop'].includes(i.prep)) || (d.utensils ?? []).includes('knife');
      if (!knife(src)) assert.ok(!knife(m), `${m.id} needs a knife`);
    }
    const r = rank({ inventory: buildInventory(k.items), targets: { protein: 30, kcal: 600 }, catalogue: all });
    const names = r.ranked.map((x) => x.meal.name);
    assert.equal(new Set(names).size, names.length, `${k.kitchen}: duplicate names`);
  }
});

test('persona kitchens: about 12 dishes each, every reached rung rated, variants included where opened', () => {
  for (const k of kitchens) {
    const q = buildRungQuiz({ kitchen: k, inventory: buildInventory(k.items) });
    assert.ok(q.deck.length <= DECK_MAX && q.deck.length >= 1, k.kitchen);
    const r = rank({ inventory: buildInventory(k.items), targets: { protein: 30, kcal: 600 }, catalogue: expandTemplates(CATALOGUE, buildInventory(k.items)) });
    const reached = new Set(r.ranked.map((x) => x.rung));
    for (const rung of reached) assert.ok(q.deck.some((d) => q.dishes[d].rung === rung), `${k.kitchen}: rung ${rung}`);
    if (r.ranked.filter((x) => x.meal.template).length >= 4) assert.ok(q.deck.some((d) => /[~+]/.test(d)), `${k.kitchen}: no variant rated`);
  }
});

test('stratify: round-robin across rungs, one variant per template before a second', () => {
  const x = (id, rung, from) => ({ meal: { id, template: from ? { from } : undefined }, rung, pierre: { tier: 'pass' }, score: 0, friction: 0 });
  const pool = [x('a', 1), x('b', 1), x('c', 1), x('a~1', 1, 'a'), x('a~2', 1, 'a'), x('b~1', 1, 'b'), x('d', 3), x('e', 3)];
  const out = stratify(pool, { max: 5 }).map((y) => y.meal.id);
  assert.equal(out.length, 5);
  assert.ok(out.includes('d') && out.includes('e'));
  assert.ok(!out.includes('a~2'));
});

// 1.55.0 (pranjal, 25 Nov): "why is Harvey's suggesting the same recipes to all levels?"
test('persona decks: each level leads with dishes the level below can’t make', async () => {
  const { levelBelow } = await import('../src/brain/rung-quiz.js');
  const decks = kitchens.map((k) => {
    const below = levelBelow(k, kitchens);
    return buildRungQuiz({ kitchen: k, inventory: buildInventory(k.items), below: below ? buildInventory(below.items) : null });
  });
  assert.equal(levelBelow(kitchens[0], kitchens), null);
  for (let i = 1; i < decks.length; i++) {
    const shared = decks[i].deck.filter((d) => decks[i - 1].deck.includes(d));
    assert.ok(shared.length <= 3, `${kitchens[i].kitchen} repeats ${shared.length} of L${i}'s dishes: ${shared}`);
    const fresh = decks[i].deck.filter((d) => decks[i].dishes[d].fresh).length;
    assert.ok(fresh >= decks[i].deck.length / 2, `${kitchens[i].kitchen}: ${fresh} new dishes`);
  }
});

test('frozen and ready-to-eat items are set aside: no food id, no dish', async () => {
  const { matchTyped } = await import('../src/brain/confirm.js');
  const have = inv(['ready-to-eat rajma masala pouch', 'leftover takeaway dal makhani', 'frozen peas', 'frozen aloo parathas', 'peas', 'canned chickpeas']);
  assert.deepEqual(have.setAside, ['ready-to-eat rajma masala pouch', 'leftover takeaway dal makhani', 'frozen peas', 'frozen aloo parathas']);
  for (const id of ['rajma', 'dal']) assert.ok(!have.have.has(id), id);
  assert.ok(have.have.has('frozen_peas') && have.have.has('chickpeas'));
  assert.equal(matchTyped('frozen sweet corn').id, null);
  for (const k of kitchens) for (const i of k.items) assert.ok(!/frozen|ready-to-eat|takeaway|pouch/i.test(i.name), `${k.kitchen}: ${i.name}`);
});

test('rung 1: close macros tie, savoury before sweet, so the curd-banana bowl no longer leads (pranjal, 26 Nov)', () => {
  const lv = (n) => kitchens.find((k) => Number(k.level) === n);
  for (const n of [2, 3, 4, 5]) {
    const have = buildInventory(lv(n).items);
    const r = rank({ inventory: have, targets: { protein: 60, calories: 1200, fiber: 20 }, context: { hour: 21, weekday: 3, kind: 'meal' }, catalogue: expandTemplates(CATALOGUE, have) });
    const rung1 = r.ladder.find((l) => l.rung === 1);
    assert.equal(rung1.pick.meal.id, 'butter_cheese_sandwich', `L${n}`);
    // Inside a band, sweet dishes keep Marco's score order.
    const order = [rung1.pick, ...rung1.alternatives].map((x) => x.meal.id);
    if (order.includes('pb_banana_sandwich') && order.includes('curd_peanut_banana_bowl')) {
      const pb = r.ranked.find((x) => x.meal.id === 'pb_banana_sandwich');
      const bowl = r.ranked.find((x) => x.meal.id === 'curd_peanut_banana_bowl');
      assert.equal(order.indexOf('pb_banana_sandwich') < order.indexOf('curd_peanut_banana_bowl'), pb.score > bowl.score, `L${n}`);
    }
  }
});

test('orderRung: a tie band needs the same tier, protein within 3 g and friction within 0.1', () => {
  const d = (id, tier, protein, score, friction, parts) => ({ rung: 1, score, friction, pierre: { tier }, meal: { id, macros: { protein }, parts: parts.map((p) => ({ id: p })), ingredients: [] } });
  const sweet = d('sweet', 'pass', 17, 0.5, 0.5, ['curd', 'banana']);
  const salty = d('salty', 'pass', 14, 0.2, 0.5, ['bread', 'cheese_slices']);
  const far = d('far', 'pass', 10, 0.1, 0.5, ['bread', 'butter']);
  const hard = d('hard', 'pass', 17, 0.4, 0.9, ['eggs']);
  const floor = d('floor', 'floor', 17, 0.9, 0.5, ['eggs']);
  assert.deepEqual(orderRung([sweet, salty, far, hard, floor]).map((x) => x.meal.id), ['salty', 'sweet', 'hard', 'far', 'floor']);
  assert.ok(isSweet(sweet.meal) && !isSweet(salty.meal));
});
