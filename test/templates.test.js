// Open-slot templates (1.54.0): the catalogue opens to whatever the kitchen has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE } from '../src/brain/catalogue.js';
import { buildInventory } from '../src/brain/inventory.js';
import { importKitchens } from '../src/brain/kitchens.js';
import { rank } from '../src/brain/ranker.js';
import { expandTemplates, variantsOf, NEVER_MICROWAVE } from '../src/brain/templates.js';
import { buildRungQuiz, stratify, DECK_MAX } from '../src/brain/rung-quiz.js';
import { PIERRE_RAW } from '../src/brain/pierre-raw.js';

const kitchens = importKitchens(readFileSync(new URL('../data/test-kitchens/kitchens.json', import.meta.url), 'utf8'));
const inv = (names) => buildInventory(names.map((name) => ({ name })));

test('templates: tofu and mushrooms open paneer slots, cooked the same way', () => {
  const have = inv(['tofu', 'mushrooms', 'air fryer', 'curd', 'garam masala', 'capsicum']);
  const ids = expandTemplates(CATALOGUE, have).map((m) => m.id);
  assert.ok(ids.includes('airfryer_paneer_tikka~tofu'));
  assert.ok(ids.includes('airfryer_paneer_tikka~mushroom'));
  const tofu = expandTemplates(CATALOGUE, have).find((m) => m.id === 'airfryer_paneer_tikka~tofu');
  assert.equal(tofu.name, 'Air-fryer tofu tikka');
  assert.equal(tofu.template.proxy, 'tofu');
  assert.ok(tofu.steps.every((s) => !/paneer/i.test(s.text)));
  const r = rank({ inventory: have, targets: { protein: 30, kcal: 600 }, catalogue: expandTemplates(CATALOGUE, have) });
  assert.ok(r.ranked.some((x) => x.meal.id === 'airfryer_paneer_tikka~tofu'));
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
