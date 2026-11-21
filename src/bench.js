// Pierre benchmark (v2 Step 4): 30 dishes, one per screen, rated veto, floor, pass or crave.
// Blind: the sheet holds names and parts only; the brain's tiers live in a key outside the
// repo. Answers save after every tap and go out by "Send to Harvey's" (a GitHub issue, and
// the clipboard).
import { encodeBench, editSlot, setRepairTier, setRepairScope, clearRepairs } from './quiz/bench.js';
import { toDishChain, applyChainEdits, slotValue, CHAIN_SLOTS } from './brain/ingredients.js';
import { foodClassOf, FOOD_CLASS } from './brain/ontology.js';

const VERSION = '1.19.0';
// ?sheet=holdout opens the Step 4c holdout sheet, ?sheet=round3 the third blind sheet; each
// sheet keeps its own answers.
const SHEETS = { benchmark: 'harveys.bench.v1', holdout: 'harveys.holdout.v1', round3: 'harveys.round3.v1' };
const asked = new URLSearchParams(location.search).get('sheet');
const SHEET = SHEETS[asked] ? asked : 'benchmark';
const KEY = SHEETS[SHEET];
const REPO_ISSUE = 'https://github.com/pranjalparashar1/harveys/issues/new';
const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sheet = null;
let state = { answers: {}, i: 0, tiers: null };
const load = () => { try { state = { ...state, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* fresh */ } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('This phone can’t save right now.'); } };

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

const done = () => sheet.dishes.filter((d) => state.answers[d.id]?.tier).length;

function render() {
  const n = sheet.dishes.length;
  if (state.i >= n) return renderEnd();
  const d = sheet.dishes[state.i];
  const a = state.answers[d.id] ?? {};
  const low = a.tier === 'veto' || a.tier === 'floor';
  document.title = `${d.name} · ${sheet.title}`;
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <a class="icon-btn" href="train.html" aria-label="Back to Train">✕</a>
    <div class="meter" role="img" aria-label="Dish ${state.i + 1} of ${n}" style="flex:1;margin:0 8px"><i style="transform:scaleX(${(state.i / n).toFixed(3)})"></i></div>
    <span class="mini">${state.i + 1}/${n}</span>
  </div></header>
  <main class="wrap play">
    <article class="qcardp">
      <h1 class="prompt" tabindex="-1">${esc(d.name)}</h1>
      ${chainBlock(d, a)}
      ${a.repair ? '<h2 class="step">As suggested</h2>' : ''}
      <div class="opts" role="radiogroup" aria-label="Your tier">${sheet.tiers.map((t) => `
        <button type="button" class="opt centre${a.tier === t.id ? ' sel' : ''}" role="radio" aria-checked="${a.tier === t.id}" data-tier="${t.id}">
          <span class="ct"><b>${esc(t.label)}</b><small>${esc(t.line)}</small></span>
        </button>`).join('')}</div>
      ${a.repair ? repairBlock(d, a) : ''}
      ${low ? `<h2 class="step">What’s off? <small class="mini">optional</small></h2><div class="chips">${sheet.reasons.map((r) => {
        const on = (a.reasons ?? []).includes(r.id);
        return `<button type="button" class="chip toggle" role="checkbox" aria-checked="${on}" data-reason="${r.id}">${esc(r.label)}</button>`;
      }).join('')}</div>` : ''}
      ${low ? fixBlock(d, a) : ''}
      <p class="mini">A food with no cooking named comes as it is.</p>
    </article>
  </main>
  <div class="actionbar"><div class="actionbar-in">
    ${state.i > 0 ? '<button class="btn ghost back" data-act="back" type="button" aria-label="Back">‹</button>' : ''}
    <button class="btn primary grow${a.tier ? '' : ' soft'}" data-act="next" type="button" aria-disabled="${!a.tier}">${state.i + 1 === n ? 'Finish' : 'Next dish'}</button>
  </div></div>`;
}

// ── Tap-to-repair: the dish as a flowchart of tappable slots ──
// Options per slot, from pranjal's round-3 pantry. Masalas (garam masala, turmeric) are offered
// as fixes only, never put in a dish; hung curd is out.
const OPTIONS = {
  cookedWith: [null, 'oil', 'olive_oil', 'butter', 'ghee'],
  seasonedWith: ['salt', 'chilli_flakes', 'black_pepper', 'chaat_masala', 'oregano', 'garam_masala', 'turmeric', 'garlic'],
  technique: ['air_fried', 'pan_fried', 'sauteed', 'boiled', 'simmered', 'toasted', 'microwaved', null],
  toppedWith: [null, 'coriander', 'onion', 'cheese_slices', 'mozzarella', 'lemon', 'peanuts', 'mint'],
  servedWith: [null, 'mayo', 'curd', 'tomato_sauce', 'chilli_sauce'],
};
const LINK = { seasonedWith: 'seasoned with', cookedWith: 'cooked with', technique: 'technique', toppedWith: 'topped with', servedWith: 'served with' };
const NONE = { seasonedWith: 'nothing', cookedWith: 'no fat', technique: 'raw, as it is', toppedWith: 'nothing', servedWith: 'nothing' };
const NAMES = { tomato_sauce: 'ketchup', olive_oil: 'olive oil', cheese_slices: 'cheese slices', chilli_flakes: 'chilli flakes', black_pepper: 'black pepper', chaat_masala: 'chaat masala', garam_masala: 'garam masala', air_fried: 'air-fried', pan_fried: 'pan-fried', sauteed: 'sautéed', pressure_cooked: 'pressure-cooked', fried_egg: 'fried', shake_milk: 'shaken with milk', shake_water: 'shaken with water' };
const nameOf = (id) => NAMES[id] ?? String(id).replace(/_/g, ' ');
const showValue = (slot, v) => (slot === 'seasonedWith' ? (v.length ? v.map(nameOf).join(', ') : NONE[slot]) : v == null ? NONE[slot] : nameOf(v));
const CLASS_WORDS = { hydrated_starch: 'soft starches', dry_starch_seed: 'grains and pulses', watery_veg_fruit: 'watery veg and fruit', dense_protein_dairy: 'paneer and cheese', delicate_protein: 'eggs', protein_powder_flour: 'powders and flours', pure_or_emulsified_fat: 'fats and dairy', aromatic_herb_acid: 'herbs and aromatics' };
let openSlot = null;
const chains = new Map();
const chainOf = (d) => { if (!chains.has(d.id)) chains.set(d.id, toDishChain(d)); return chains.get(d.id); };

function chainBlock(d, a) {
  const orig = chainOf(d);
  const now = applyChainEdits(orig, a.repair?.edits ?? []);
  const edited = new Set((a.repair?.edits ?? []).map((e) => e.slot));
  const chip = (slot) => {
    const was = showValue(slot, slotValue(orig, slot));
    const is = showValue(slot, slotValue(now, slot));
    const label = edited.has(slot) ? `${was} → ${is}` : is;
    return `<li class="chain-row"><span class="chain-link">→ ${esc(LINK[slot])}</span><button type="button" class="chain-chip${edited.has(slot) ? ' edited' : ''}${openSlot === slot ? ' open' : ''}" data-slot="${slot}" aria-expanded="${openSlot === slot}">${esc(label)}</button></li>${openSlot === slot ? trayOf(slot, orig, now) : ''}`;
  };
  const also = (orig.with ?? []).map((p) => nameOf(p.id) + (p.technique ? ` (${nameOf(p.technique)})` : '')).join(', ');
  return `<ol class="chain" aria-label="The dish, step by step">
    <li class="chain-row"><span class="chain-node">${esc(orig.anchor ? nameOf(orig.anchor.id) : d.parts)}</span>${also ? `<span class="chain-also">with ${esc(also)}</span>` : ''}</li>
    ${CHAIN_SLOTS.filter((s) => s !== 'anchor').map(chip).join('')}
  </ol>
  <p class="mini">Tap a step to change it.</p>`;
}

function trayOf(slot, orig, now) {
  const cur = slotValue(now, slot);
  const base = slotValue(orig, slot);
  const list = slot === 'seasonedWith' ? [...new Set([...base, ...cur, ...OPTIONS[slot]])] : [...new Set([...OPTIONS[slot], base, cur])];
  const on = (v) => (slot === 'seasonedWith' ? cur.includes(v) : cur === v);
  return `<li class="chain-tray" role="group" aria-label="${esc(LINK[slot])}">${list.map((v) => `<button type="button" class="chip toggle" role="${slot === 'seasonedWith' ? 'checkbox' : 'radio'}" aria-checked="${on(v)}" data-pick="${v ?? ''}">${esc(v == null ? NONE[slot] : nameOf(v))}</button>`).join('')}</li>`;
}

function repairBlock(d, a) {
  const r = a.repair;
  const orig = chainOf(d);
  const what = r.edits.map((e) => `${LINK[e.slot]}: ${showValue(e.slot, e.to)}`).join(', ');
  const cls = orig.anchor ? foodClassOf(orig.anchor.id) : null;
  const tech = orig.technique ? nameOf(orig.technique) : 'raw';
  const members = cls ? Object.keys(FOOD_CLASS).filter((id) => FOOD_CLASS[id] === cls).slice(0, 4).map(nameOf).join(', ') : '';
  const scope = (v, label) => `<button type="button" class="chip toggle" role="radio" aria-checked="${r.scope === v}" data-scope="${v}">${esc(label)}</button>`;
  return `<h2 class="step">With your fix <small class="mini">(${esc(what)})</small></h2>
    <div class="chips" role="radiogroup" aria-label="Tier with your fix">${sheet.tiers.map((t) => `<button type="button" class="chip toggle" role="radio" aria-checked="${r.afterTier === t.id}" data-aftertier="${t.id}">${esc(t.label)}</button>`).join('')}</div>
    <div class="chips scope" role="radiogroup" aria-label="Teach the fix">
      ${cls ? scope('class', `Teach it for all ${CLASS_WORDS[cls] ?? cls} (${members}) ${tech}`) : ''}
      ${scope('dish', 'Just this dish')}
    </div>
    <button type="button" class="btn link quiet" data-act="undo-fix">Undo fix</button>`;
}

// "Fix it": change any part's cooking, or drop it, then say what the fixed dish reaches.
function fixBlock(d, a) {
  const ch = a.fix?.changes ?? {};
  const label = (id) => id.replace(/_/g, ' ');
  const rows = d.items.map((it, i) => {
    const v = ch[i] ?? it.technique ?? '';
    const opts = [['', 'as it is'], ...sheet.techniques.map((t) => [t.id, t.label]), ['drop', 'drop it']];
    if (it.technique && !sheet.techniques.some((t) => t.id === it.technique)) opts.splice(1, 0, [it.technique, label(it.technique)]);
    return `<label class="fixrow"><span>${esc(label(it.id))}</span><select data-fix="${i}">${opts.map(([id, l]) => `<option value="${id}"${v === id ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }).join('');
  const changed = Object.keys(ch).length > 0;
  return `<h2 class="step">Fix it <small class="mini">optional</small></h2>
    <div class="fix">${rows}</div>
    ${changed ? `<h2 class="step">Fixed, it would be</h2><div class="chips">${sheet.tiers.map((t) => `<button type="button" class="chip toggle" role="radio" aria-checked="${a.fix?.tier === t.id}" data-fixtier="${t.id}">${esc(t.label)}</button>`).join('')}</div>` : ''}`;
}

function renderEnd() {
  const body = encodeBench(sheet, state.answers, state.tiers);
  const href = `${REPO_ISSUE}?${new URLSearchParams({ title: `${sheet.title}: ${done()} dishes`, labels: 'benchmark', body: '```\n' + body + '\n```' })}`;
  const q = (v, label) => `<button type="button" class="opt centre${state.tiers === v ? ' sel' : ''}" role="radio" aria-checked="${state.tiers === v}" data-tiers="${v}"><span class="ct"><b>${label}</b></span></button>`;
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <a class="icon-btn" href="train.html" aria-label="Back to Train">✕</a>
    <h1>${esc(sheet.title)}</h1>
  </div></header>
  <main class="wrap play"><div class="endcard">
    <h1 class="prompt">${done()} of ${sheet.dishes.length} dishes rated</h1>
    <h2 class="step">Were four tiers enough?</h2>
    <div class="opts" role="radiogroup" aria-label="Were four tiers enough">${q('enough', 'Yes, four was enough')}${q('finer', 'No, some dishes needed finer steps')}</div>
    <div class="cta">
      <a class="btn primary xl send" data-act="send" href="${esc(href)}" target="_blank" rel="noopener">Send to Harvey’s</a>
      <button class="btn ghost" data-act="back" type="button">Back to the last dish</button>
      <button class="btn link quiet reset" data-act="reset" type="button">Start over</button>
    </div>
    <p class="mini center version">Harvey’s ${VERSION} · ${esc(sheet.title)}</p>
  </div></main>`;
}

let armed = 0;
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tier],[data-reason],[data-fixtier],[data-tiers],[data-act],[data-slot],[data-pick],[data-aftertier],[data-scope]');
  if (!el) return;
  const d = sheet.dishes[state.i];
  if (el.dataset.slot) {
    openSlot = openSlot === el.dataset.slot ? null : el.dataset.slot;
    const y = scrollY;
    render();
    scrollTo(0, y);
    return;
  } else if (el.dataset.pick != null && openSlot) {
    const orig = chainOf(d);
    const a = state.answers[d.id] ?? {};
    const now = applyChainEdits(orig, a.repair?.edits ?? []);
    const v = el.dataset.pick || null;
    const cur = slotValue(now, openSlot);
    const value = openSlot === 'seasonedWith' ? (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]) : v;
    state.answers[d.id] = editSlot(a, openSlot, value, orig);
    if (openSlot !== 'seasonedWith') openSlot = null;
  } else if (el.dataset.aftertier) {
    const a = state.answers[d.id];
    state.answers[d.id] = setRepairTier(a, a.repair?.afterTier === el.dataset.aftertier ? null : el.dataset.aftertier);
  } else if (el.dataset.scope) {
    state.answers[d.id] = setRepairScope(state.answers[d.id], el.dataset.scope);
  } else if (el.dataset.act === 'undo-fix') {
    state.answers[d.id] = clearRepairs(state.answers[d.id]);
    openSlot = null;
  } else if (el.dataset.tier) {
    const a = state.answers[d.id] ?? {};
    const keep = el.dataset.tier === 'veto' || el.dataset.tier === 'floor';
    state.answers[d.id] = { tier: el.dataset.tier, reasons: keep ? (a.reasons ?? []) : [], ...(keep && a.fix ? { fix: a.fix } : {}), ...(a.repair ? { repair: a.repair } : {}), at: new Date().toISOString() };
  } else if (el.dataset.fixtier) {
    const a = state.answers[d.id];
    a.fix = { ...a.fix, tier: a.fix?.tier === el.dataset.fixtier ? null : el.dataset.fixtier };
    a.at = new Date().toISOString();
  } else if (el.dataset.reason) {
    const a = state.answers[d.id];
    const r = el.dataset.reason;
    a.reasons = a.reasons.includes(r) ? a.reasons.filter((x) => x !== r) : [...a.reasons, r];
    a.at = new Date().toISOString();
  } else if (el.dataset.tiers) {
    state.tiers = el.dataset.tiers;
  } else {
    const act = el.dataset.act;
    openSlot = null;
    if (act === 'next') {
      if (!state.answers[d.id]?.tier) return toast('Pick a tier to go on.');
      if (state.answers[d.id].repair?.edits?.length && !state.answers[d.id].repair.afterTier) return toast('Rate the dish with your fix, or undo it.');
      state.i += 1;
    } else if (act === 'back') {
      state.i = Math.max(0, state.i - 1);
    } else if (act === 'send') {
      navigator.clipboard?.writeText(encodeBench(sheet, state.answers, state.tiers)).then(() => toast('Copied, and opening GitHub.'), () => {});
      return;
    } else if (act === 'reset') {
      if (Date.now() - armed > 4000) { armed = Date.now(); el.textContent = 'Tap again to erase'; return; }
      state = { answers: {}, i: 0, tiers: null };
    }
    save();
    render();
    scrollTo(0, 0);
    return;
  }
  save();
  const y = scrollY;
  render();
  scrollTo(0, y);
});

app.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-fix]');
  if (!sel) return;
  const d = sheet.dishes[state.i];
  const a = state.answers[d.id];
  const i = Number(sel.dataset.fix);
  const changes = { ...(a.fix?.changes ?? {}) };
  if (sel.value === (d.items[i].technique ?? '')) delete changes[i]; else changes[i] = sel.value;
  a.fix = Object.keys(changes).length ? { ...a.fix, changes } : undefined;
  a.at = new Date().toISOString();
  save();
  const y = scrollY;
  render();
  scrollTo(0, y);
});

async function init() {
  const res = await fetch(new URL(`./quiz/${SHEET}.json${new URL(import.meta.url).search}`, import.meta.url));
  sheet = await res.json();
  load();
  state.i = Math.min(state.i, sheet.dishes.length);
  render();
}
init().catch((e) => { app.innerHTML = `<p class="error">${esc(e.message)}</p>`; });
