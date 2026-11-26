// 1.60.0: the home page's saved kitchen, its backup link, and "Ran out of any of these?".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KITCHEN_KEY, normalizeKitchen, loadKitchen, saveKitchen, confirmedItems, encodeBackup, decodeBackup,
  backupLink, restoreCode, withoutIds, withItems, ranOutChoices, kitchenGroups, countItems,
} from '../src/brain/kitchen-store.js';
import { CATALOGUE, rank, buildInventory, PIERRE_SEED } from '../src/brain/index.js';
import { WAYS } from '../src/brain/ways.js';

const mem = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const ITEMS = [
  { name: 'Eggs', canonical: 'eggs', category: 'protein' },
  { name: 'Amul butter', canonical: null, category: 'dairy' },
  { name: 'white bread' },
  'induction cooktop',
  { name: 'Frying pan', canonical: 'frying_pan', category: 'cookware' },
  { name: 'plates' },
];
const WAYS_PICKED = { boil_eggs: ['pot'], scramble_eggs: ['pan'], toast_bread: ['none'], boil_water: [] };

test('a kitchen saves and loads under harveys.kitchen.v1, and the marco.* keys are left alone', () => {
  const ls = mem();
  ls.setItem('marco.cookLog', '[1]');
  const saved = saveKitchen({ items: ITEMS, ways: WAYS_PICKED, missingBasics: ['oil'] }, ls, '2026-11-26T12:00:00Z');
  assert.ok(ls.m.has(KITCHEN_KEY));
  assert.equal(ls.m.get('marco.cookLog'), '[1]');
  const back = loadKitchen(ls);
  assert.deepEqual(back, saved);
  assert.equal(back.version, 1);
  assert.equal(back.updatedAt, '2026-11-26T12:00:00Z');
  assert.deepEqual(back.ways, WAYS_PICKED);
  assert.deepEqual(back.missingBasics, ['oil']);
  assert.equal(back.items.length, ITEMS.length);
  assert.equal(back.items.find((i) => i.name === 'induction cooktop').canonical, null, 'a string item keeps its name');
  saveKitchen(null, ls);
  assert.equal(loadKitchen(ls), null);
});

test('a broken or empty save is no kitchen, not a crash', () => {
  const ls = mem();
  ls.setItem(KITCHEN_KEY, '{not json');
  assert.equal(loadKitchen(ls), null);
  assert.equal(normalizeKitchen({ items: [] }), null);
  assert.equal(normalizeKitchen({ items: [{ name: '  ' }, null, 3] }), null);
  assert.equal(normalizeKitchen({ items: [{ name: 'eggs', canonical: 'not_an_id' }] }).items[0].canonical, null, 'unknown ids are dropped');
  assert.equal(normalizeKitchen({ items: ['eggs', 'Eggs', { name: 'egg', canonical: 'eggs' }, { name: 'x', canonical: 'eggs' }] }).items.length, 2, 'one item per name and per id');
});

test('the confirm screens end on the list minus unticks, plus ticks and typed things', () => {
  const items = confirmedItems(ITEMS, {
    removed: ['white bread'],
    have: ['saucepan', 'eggs'],
    typed: [{ text: 'soy sauce', id: null }, { text: 'panir', id: 'paneer' }],
  });
  const names = items.map((i) => i.name);
  assert.ok(!names.includes('white bread'));
  assert.ok(items.some((i) => i.canonical === 'saucepan' && i.category === 'cookware'));
  assert.ok(items.some((i) => i.canonical === 'paneer'));
  assert.ok(items.some((i) => i.name === 'soy sauce' && i.canonical === null));
  assert.equal(items.filter((i) => i.canonical === 'eggs').length, 1, 'eggs ticked again are not added twice');
  assert.deepEqual(confirmedItems(ITEMS, {}).map((i) => i.name), ITEMS.map((i) => (typeof i === 'string' ? i : i.name)));
});

test('a backup link round-trips the items, the ways and the missing basics', async () => {
  const kitchen = normalizeKitchen({ items: ITEMS, ways: WAYS_PICKED, missingBasics: ['oil'] });
  const code = await encodeBackup(kitchen);
  assert.match(code, /^1[A-Za-z0-9_-]+$/, 'deflated, link-safe');
  const link = backupLink(code, 'https://pranjalparashar1.github.io/harveys/');
  assert.equal(restoreCode(new URL(link).hash), code);
  const back = await decodeBackup(code, '2026-11-26T13:00:00Z');
  assert.deepEqual(back.items.map((i) => [i.name, i.canonical]), kitchen.items.map((i) => [i.name, i.canonical]));
  assert.deepEqual(back.ways, WAYS_PICKED);
  assert.deepEqual(back.missingBasics, ['oil']);
  assert.equal(back.updatedAt, '2026-11-26T13:00:00Z');
  // The same kitchen ranks the same on the new phone.
  const ladder = (k) => rank({ inventory: buildInventory(k.items), targets: { protein: 40, calories: 800, fiber: 15 }, context: { kind: 'meal', hour: 19, weekday: 3 }, catalogue: CATALOGUE, verdicts: PIERRE_SEED }).ladder.map((g) => g.pick.meal.id);
  assert.deepEqual(ladder(back), ladder(kitchen));
});

test('a big kitchen still makes a short backup link; a cut one restores nothing', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ name: `Item number ${i}` }));
  const code = await encodeBackup({ items: [...ITEMS, ...many], ways: Object.fromEntries(WAYS.map((w) => [w.id, [w.opts[0].id]])) });
  assert.ok(code.length < 1500, `${code.length} characters`);
  assert.equal(await decodeBackup(code.slice(0, code.length - 12)), null);
  assert.equal(await decodeBackup('nonsense!'), null);
  assert.equal(await decodeBackup(''), null);
  assert.equal(restoreCode('#k=1abc'), null);
  assert.equal(restoreCode('#restore=1ab_-c'), '1ab_-c');
});

test('ran out: the used-up foods a dish named, and taking them out of the kitchen', () => {
  const names = ['eggs', 'white bread', 'Amul butter', 'induction', 'frying pan', 'salt', 'black pepper', 'rice'];
  const r = rank({ inventory: buildInventory(names), targets: { protein: 40, calories: 800, fiber: 15 }, context: { kind: 'meal', hour: 19, weekday: 3 }, catalogue: CATALOGUE, verdicts: PIERRE_SEED });
  const omelette = r.ranked.find((x) => x.meal.id === 'bread_omelette');
  assert.ok(omelette, 'bread omelette is on');
  const ids = ranOutChoices(omelette).map((c) => c.id);
  assert.ok(ids.includes('eggs') && ids.includes('bread'));
  assert.ok(!ids.includes('salt') && !ids.includes('butter') && !ids.includes('black_pepper'), 'staples last');
  const { items, removed } = withoutIds(names.map((name) => ({ name })), ['eggs']);
  assert.deepEqual(removed.map((i) => i.name), ['eggs']);
  assert.ok(!items.some((i) => i.name === 'eggs'));
  assert.equal(withItems(items, removed).length, names.length, 'tapping the chip again puts it back');
});

test('My kitchen groups food and cookware, and leaves the plates out of the count', () => {
  const g = kitchenGroups(normalizeKitchen({ items: ITEMS }).items);
  assert.deepEqual(g.kit.map((x) => x.item.name).sort(), ['Frying pan', 'induction cooktop']);
  assert.ok(g.food.some((x) => x.id === 'butter'));
  assert.equal(countItems(normalizeKitchen({ items: ITEMS }).items), 5);
});

test('a butter knife is a knife and an egg boiler is kit, not butter and eggs', () => {
  const g = kitchenGroups([{ name: 'butter knife' }, { name: 'egg boiler' }, { name: 'eggs' }]);
  assert.deepEqual(g.food.map((x) => x.id), ['eggs']);
  assert.deepEqual(g.kit.map((x) => x.id), ['egg_boiler']);
  assert.ok(!buildInventory(['butter knife', 'egg boiler']).have.has('eggs'));
  assert.ok(!buildInventory(['butter knife']).have.has('butter'));
});
