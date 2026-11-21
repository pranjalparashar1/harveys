import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TECHNIQUE_PREFS, TASTE_PICKS, preferredTechnique } from '../src/brain/technique-prefs.js';
import { PREP_ALL, prepChoices } from '../src/quiz/prep.js';
import { CATALOGUE } from '../src/brain/catalogue.js';

test('every taste pick points at a real round 2 question', () => {
  const ids = new Set(PREP_ALL.map((q) => q.id));
  for (const id of TASTE_PICKS) assert.ok(ids.has(id), id);
  assert.equal(preferredTechnique('rice').prefer, 'rinsed until the water runs clear');
  assert.equal(preferredTechnique('nope'), null);
  assert.ok(TECHNIQUE_PREFS.every((p) => p.prefer && p.over && p.evidence.length));
});

test('--no-taste drops the taste picks', () => {
  const answers = Object.fromEntries(TASTE_PICKS.map((id) => [id, { pick: 'a', at: null }]));
  assert.equal(prepChoices(answers).length, TASTE_PICKS.length);
  assert.equal(prepChoices(answers, { noTaste: true }).length, 0);
});

test('catalogue already follows them: rice washed, dal tadka in its own pan', () => {
  for (const m of CATALOGUE) {
    const rice = m.ingredients?.find((i) => i.id === 'rice');
    if (rice) assert.equal(rice.prep, 'wash', m.id);
  }
  const dal = CATALOGUE.find((m) => m.id === 'dal_tadka_rice');
  assert.ok(dal.steps.some((s) => /pour the tadka over/i.test(s.text)));
});
