import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeKitchen, decodeKitchen, kitchenLink, linkCode, linkName, guessName, packKitchen, unpackKitchen } from '../src/brain/share-link.js';
import { importKitchens } from '../src/brain/kitchens.js';
import { kitchenId } from '../src/brain/kitchen-test.js';

const [kitchen] = JSON.parse(readFileSync(new URL('./fixtures/bachelor-kitchen.json', import.meta.url), 'utf8'));

test('a kitchen survives the link: same items, same kitchen id, so results line up', async () => {
  const back = await decodeKitchen(await encodeKitchen(kitchen));
  assert.equal(back.kitchen, kitchen.kitchen);
  assert.deepEqual(back.items.map((i) => i.name), kitchen.items.map((i) => i.name));
  assert.deepEqual(back.items.map((i) => i.category), kitchen.items.map((i) => i.category ?? 'other'));
  assert.equal(kitchenId(importKitchens([back])[0]), kitchenId(importKitchens([kitchen])[0]));
});

test('a 58-item kitchen makes a link short enough for WhatsApp and SMS, in safe characters', async () => {
  const link = await kitchenLink(kitchen);
  assert.ok(link.length < 1200, `link is ${link.length} characters`);
  assert.match(link, /^https:\/\/pranjalparashar1\.github\.io\/harveys\/#k=1[A-Za-z0-9_-]+$/);
  assert.equal(linkCode(new URL(link).hash), link.split('#k=')[1]);
});

test('a link cut short by a chat app fails cleanly, never a half kitchen', async () => {
  const code = await encodeKitchen(kitchen);
  assert.equal(await decodeKitchen(code.slice(0, code.length - 40)), null);
  assert.equal(await decodeKitchen('1!!!'), null);
  assert.equal(await decodeKitchen(''), null);
});

test('names with newlines or the separator are flattened, not split', () => {
  const k = unpackKitchen(packKitchen({ kitchen: 'A\nB', items: [{ name: 'salt ~ pepper', category: 'spice' }, { name: 'eggs\n' }] }));
  assert.equal(k.kitchen, 'A B');
  assert.deepEqual(k.items, [{ name: 'salt pepper', category: 'spice' }, { name: 'eggs', category: 'other' }]);
});

test('linkCode finds k= beside other hash keys', () => {
  assert.equal(linkCode('#k=1abc'), '1abc');
  assert.equal(linkCode('#relay=off&k=0xyz'), '0xyz');
  assert.equal(linkCode('#send=abc'), null);
});

test('1.35.0: the tester’s name rides in front of the kitchen and comes back clean', async () => {
  const link = await kitchenLink(kitchen, 'https://x.test/', 'Riya Sen');
  assert.match(link, /^https:\/\/x\.test\/#n=Riya%20Sen&k=1/);
  const hash = link.slice(link.indexOf('#'));
  assert.equal(linkName(hash), 'Riya Sen');
  assert.ok(await decodeKitchen(linkCode(hash)), 'the kitchen still decodes behind the name');
  assert.equal(linkName('#k=1abc'), '');
  assert.equal(linkName('#n=<b>Zo%C3%AB</b>&k=1'), 'b Zoë /b');
  assert.equal(linkName('#n=%E0%A4'), '%E0%A4'.slice(0, 40), 'a broken escape doesn’t throw');
  assert.doesNotMatch(await kitchenLink(kitchen, 'https://x.test/', '  '), /n=/);
});

test('1.35.0: a first-name guess from the kitchen label, or nothing', () => {
  assert.equal(guessName('Riya, Bandra'), 'Riya');
  assert.equal(guessName('Sam’s kitchen'), 'Sam');
  assert.equal(guessName("Arjun's flat, Pune"), 'Arjun');
  assert.equal(guessName('Aspirational bachelor kitchen'), '');
  assert.equal(guessName('Shared flat in Koramangala, 3 people'), '');
});
