// Kitchen test mode (1.30.0). Load kitchens, then per kitchen: Pierre → Marco → White → Send.
// Every kitchen keeps its own answers in this browser, so many can be run back to back.
// The brain work lives in src/brain/kitchen-test.js; this file is only screens and storage.
import { loadKitchens, buildKitchenTest, whiteFor, marcoChoices, fitFrom, encodeResult, MOMENT, WHITE_ANSWERS } from './brain/kitchen-test.js';

const VERSION = '1.30.0';
const KEY = 'harveys.ktest.v1';
const REPO_ISSUE = 'https://github.com/pranjalparashar1/harveys/issues/new';
const DEFAULT_PERSONA = 'Novice: the only thing I can cook is instant noodles';
const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// store: { persona, pasted: [kitchen], runs: { [kitchenId]: { pierre, marco, white, instead, stage, i, sent } } }
let store = { persona: DEFAULT_PERSONA, pasted: [], runs: {} };
const load = () => { try { store = { ...store, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* fresh */ } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { toast('This browser can’t save right now.'); } };

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

let builtIn = [];
let cache = {}; // data/ingredient-cache.json: flash-lite profiles from import-kitchens --classify
const tests = new Map();
const kitchens = () => {
  const seen = new Set();
  return [...builtIn, ...store.pasted].filter((k) => !seen.has(k.id) && seen.add(k.id));
};
const testOf = (k) => {
  if (!tests.has(k.id)) tests.set(k.id, buildKitchenTest(k, { cache }));
  return tests.get(k.id);
};
const runOf = (id) => {
  store.runs[id] ??= { pierre: {}, marco: {}, white: {}, instead: null, stage: 'pierre', i: 0 };
  return store.runs[id];
};
const STAGES = ['pierre', 'marco', 'white', 'instead', 'end'];

let current = null; // kitchen id on screen, or null for the list

// ── List ────────────────────────────────────────────────────────────────────
function progressOf(k) {
  const t = testOf(k);
  const r = store.runs[k.id];
  if (!r) return 'Not started';
  const n = (o) => Object.keys(o ?? {}).length;
  const bits = [`Pierre ${n(r.pierre)}/${t.pierre.length}`, `Marco ${n(r.marco)}/${t.marco.length}`, `White ${n(r.white) ? 'done' : '–'}`];
  return `${bits.join(' · ')}${r.sent ? ' · sent' : ''}`;
}

function renderList() {
  document.body.classList.remove('quiz');
  document.title = 'Kitchen test · Harvey’s';
  const list = kitchens();
  app.innerHTML = `
  <main class="shell">
    <header class="hero hero-row"><h1>Kitchen test</h1><a class="btn link" href="train.html">Train</a></header>
    <section class="card">
      <label class="field"><span>Who you’re playing</span>
        <input type="text" id="persona" value="${esc(store.persona)}" aria-label="Who you’re playing"></label>
      <p class="mini">Every answer trains Harvey’s. Every test asks about one moment: ${esc(MOMENT.label)}.</p>
    </section>
    ${list.map((k) => {
      const t = testOf(k);
      const r = store.runs[k.id];
      return `<section class="card pierre-card">
        <h2>${esc(k.kitchen)}</h2>
        <p class="mini">${t.summary.items} items · ${t.summary.cookable} dishes Harvey’s can make${t.summary.unknown.length ? ` · unknown: ${esc(t.summary.unknown.join(', '))}` : ''}</p>
        <p class="mini">${esc(progressOf(k))}</p>
        <div class="cta">
          <button class="btn ${r?.sent ? '' : 'primary '}xl" data-open="${esc(k.id)}" type="button">${r ? (r.stage === 'end' ? 'Results' : 'Continue') : 'Begin'}</button>
          ${store.pasted.some((p) => p.id === k.id) ? `<button class="btn link quiet" data-remove="${esc(k.id)}" type="button">Remove</button>` : ''}
        </div>
      </section>`;
    }).join('')}
    <section class="card">
      <h2>Add kitchens</h2>
      <p class="mini">Paste kitchen JSON, one or many: <code>{"kitchen", "items": [{"name", "category"}], "diet", "notes"}</code>.</p>
      <textarea id="paste" rows="5" placeholder='[{"kitchen":"…","items":[{"name":"eggs","category":"protein"}]}]'></textarea>
      <div class="cta"><button class="btn" data-act="add" type="button">Add</button></div>
    </section>
    <section class="card">
      <div class="cta">
        <button class="btn" data-act="all" type="button">Download all results</button>
        <button class="btn link quiet reset" data-act="wipe" type="button">Erase all answers</button>
      </div>
      <p class="mini center version">Harvey’s ${VERSION} · kitchen test</p>
    </section>
  </main>`;
}

// ── Quiz screens ────────────────────────────────────────────────────────────
function frame(k, step, n, label, body, { back = true, next = 'Skip' } = {}) {
  return `
  <header class="top play"><div class="top-in">
    <button class="icon-btn" data-act="home" type="button" aria-label="All kitchens">✕</button>
    <div class="meter" role="img" aria-label="${esc(label)} ${step + 1} of ${n}" style="flex:1;margin:0 8px"><i style="transform:scaleX(${(n ? step / n : 1).toFixed(3)})"></i></div>
    <span class="mini">${esc(label)} ${Math.min(step + 1, n)}/${n}</span>
  </div></header>
  <main class="wrap play"><article class="qcardp">${body}</article></main>
  <div class="actionbar"><div class="actionbar-in">
    ${back ? '<button class="btn ghost back" data-act="back" type="button" aria-label="Back">‹</button>' : ''}
    <button class="btn ghost grow" data-act="skip" type="button">${next}</button>
  </div></div>`;
}

const facts = (d) => `<span class="reasons">${(d.facts ?? []).map((f) => `<span>${esc(f)}</span>`).join('')}${d.protein != null ? `<span>${esc(d.protein)} g protein</span>` : ''}</span>`;
const choice = (attr, value, on, title, small, extra = '') => `<button type="button" class="opt centre${on ? ' sel' : ''}" role="radio" aria-checked="${on}" data-${attr}="${esc(value)}">
  <span class="ct"><b>${esc(title)}</b>${small ? `<small>${esc(small)}</small>` : ''}${extra}</span></button>`;

const PIERRE_LABELS = [['veto', 'Won’t eat it'], ['floor', 'Only if nothing else'], ['pass', 'Happy to eat it'], ['crave', 'Would want it']];
const WHITE_LABELS = { yes: 'Yes, I’d make this', maybe: 'Maybe', no: 'No' };

function white(k) {
  const t = testOf(k);
  const r = runOf(k.id);
  return whiteFor(t, { pierreAnswers: r.pierre, fit: fitFrom(marcoChoices(t, r.marco, r.pierre)) });
}

function renderKitchen(k) {
  document.body.classList.add('quiz');
  const t = testOf(k);
  const r = runOf(k.id);
  if (r.stage === 'pierre' && r.i >= t.pierre.length) Object.assign(r, { stage: 'marco', i: 0 });
  if (r.stage === 'marco' && r.i >= t.marco.length) Object.assign(r, { stage: 'white', i: 0 });
  document.title = `${k.kitchen} · Kitchen test`;

  if (r.stage === 'pierre') {
    const q = t.pierre[r.i];
    const pick = r.pierre[q.id];
    app.innerHTML = frame(k, r.i, t.pierre.length, 'Pierre', `
      <p class="mini">${esc(k.kitchen)} · how does it taste to you?</p>
      <h1 class="prompt" tabindex="-1">${esc(q.name)}</h1>
      <p class="mini">${esc(q.how)}</p>
      <div class="opts" role="radiogroup" aria-label="Pierre">${PIERRE_LABELS.map(([v, l]) => choice('tier', v, pick === v, l, '')).join('')}</div>`,
    { back: r.i > 0, next: pick ? 'Next' : 'Skip' });
    return;
  }
  if (r.stage === 'marco') {
    const q = t.marco[r.i];
    const pick = r.marco[q.id];
    const chip = (v, l) => `<button type="button" class="chip toggle" role="radio" aria-checked="${pick === v}" data-pick="${v}">${l}</button>`;
    app.innerHTML = frame(k, r.i, t.marco.length, 'Marco', `
      <p class="mini">${esc(MOMENT.label)}</p>
      <h1 class="prompt" tabindex="-1">Which would you actually make?</h1>
      <div class="opts" role="radiogroup" aria-label="Which dish">${choice('pick', 'a', pick === 'a', q.A.name, q.A.how, facts(q.A))}${choice('pick', 'b', pick === 'b', q.B.name, q.B.how, facts(q.B))}</div>
      <div class="chips" role="radiogroup" aria-label="Or">${chip('either', 'Either')}${chip('neither', 'Neither tonight')}</div>`,
    { next: pick ? 'Next' : 'Skip' });
    return;
  }
  if (r.stage === 'white') {
    const w = white(k);
    if (!w.ladder.length) {
      app.innerHTML = frame(k, 0, 1, 'White', `<h1 class="prompt">Harvey’s has nothing to suggest here</h1>
        <p class="mini">${w.unlocks.length ? `Buying ${esc(w.unlocks.join(', '))} would unlock dishes.` : 'No dish in the catalogue fits this kitchen.'}</p>`, { next: 'Next' });
      return;
    }
    const d = w.ladder[Math.min(r.i, w.ladder.length - 1)];
    const pick = r.white[d.id];
    app.innerHTML = frame(k, r.i, w.ladder.length, 'White', `
      <p class="mini">${r.i === 0 ? 'Harvey’s recommends' : 'Harvey’s other suggestion'} · ${esc(d.rungName.toLowerCase())}</p>
      <h1 class="prompt" tabindex="-1">${esc(d.name)}</h1>
      <p class="mini">${esc(d.how)}</p>
      <p>${facts(d)}</p>
      <h2 class="mini">${esc(MOMENT.label)}. Would you make this?</h2>
      <div class="opts" role="radiogroup" aria-label="Would you make it">${WHITE_ANSWERS.map((v) => choice('white', v, pick === v, WHITE_LABELS[v], '')).join('')}</div>`,
    { next: pick ? 'Next' : 'Skip' });
    return;
  }
  if (r.stage === 'instead') {
    const dishes = Object.values(t.dishes);
    app.innerHTML = frame(k, 0, 1, 'White', `
      <h1 class="prompt" tabindex="-1">What would you actually make tonight?</h1>
      <div class="opts" role="radiogroup" aria-label="What you'd make">
        ${dishes.map((d) => choice('instead', d.id, r.instead === d.id, d.name, '')).join('')}
        ${choice('instead', 'nothing', r.instead === 'nothing', 'Nothing here: I’d order in or skip', '')}
      </div>`, { next: r.instead ? 'Finish' : 'Skip' });
    return;
  }
  renderEnd(k);
}

// ── Send to Harvey's ────────────────────────────────────────────────────────
const resultOf = (k) => encodeResult(testOf(k), runOf(k.id), { version: VERSION, at: new Date().toISOString(), persona: store.persona });

function issueHref(result) {
  const title = `Kitchen test: ${result.kitchen.kitchen}`;
  const make = (res) => `${REPO_ISSUE}?${new URLSearchParams({ title, labels: 'kitchen-test', body: '```json\n' + JSON.stringify(res) + '\n```' })}`;
  let href = make(result);
  // GitHub drops very long URLs: the kitchen's items are the bulk, and the downloaded file keeps them.
  if (href.length > 7800) href = make({ ...result, kitchen: { ...result.kitchen, items: `${result.kitchen.items.length} items, see the downloaded file` } });
  return href;
}

function download(name, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderEnd(k) {
  const res = resultOf(k);
  const w = white(k);
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <button class="icon-btn" data-act="home" type="button" aria-label="All kitchens">✕</button>
    <h1>${esc(k.kitchen)}</h1>
  </div></header>
  <main class="wrap play"><div class="endcard">
    <h1 class="prompt">${res.pierre.length} Pierre, ${res.marco.length} Marco, ${Object.keys(res.white.answers).length} White</h1>
    <p class="mini center">Harvey’s now leads with ${esc(w.top?.name ?? 'nothing')}${res.fit ? `. Marco fit ${res.fit.hits}/${res.fit.n} of your picks (weights now: ${res.fit.priorHits}/${res.fit.n}).` : '.'}</p>
    <div class="cta">
      <a class="btn primary xl send" data-act="send" href="${esc(issueHref(res))}" target="_blank" rel="noopener">Send to Harvey’s</a>
      <button class="btn" data-act="next" type="button">Next kitchen</button>
      <button class="btn ghost" data-act="back" type="button">Back to the last one</button>
      <button class="btn link quiet reset" data-act="reset" type="button">Start this kitchen over</button>
    </div>
    <p class="mini center version">Harvey’s ${VERSION} · ${esc(res.kitchenId)}</p>
  </div></main>`;
}

// ── Taps ────────────────────────────────────────────────────────────────────
function advance(k) {
  const t = testOf(k);
  const r = runOf(k.id);
  const len = { pierre: t.pierre.length, marco: t.marco.length, white: Math.max(1, white(k).ladder.length), instead: 1 }[r.stage] ?? 0;
  r.i += 1;
  if (r.i >= len) Object.assign(r, { stage: STAGES[STAGES.indexOf(r.stage) + 1] ?? 'end', i: 0 });
}

function retreat(k) {
  const t = testOf(k);
  const r = runOf(k.id);
  if (r.i > 0) { r.i -= 1; return; }
  const prev = STAGES[STAGES.indexOf(r.stage) - 1];
  if (!prev) return;
  const len = { pierre: t.pierre.length, marco: t.marco.length, white: white(k).ladder.length, instead: 1 }[prev];
  Object.assign(r, { stage: prev, i: Math.max(0, len - 1) });
  if (!len) retreat(k);
}

function render() {
  const k = current && kitchens().find((x) => x.id === current);
  if (k) renderKitchen(k);
  else renderList();
  scrollTo(0, 0);
}

let armed = 0;
let advanceT;
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tier],[data-pick],[data-white],[data-instead],[data-act],[data-open],[data-remove]');
  if (!el) return;
  clearTimeout(advanceT);
  const k = current && kitchens().find((x) => x.id === current);
  if (el.dataset.open) { current = el.dataset.open; render(); return; }
  if (el.dataset.remove) {
    store.pasted = store.pasted.filter((p) => p.id !== el.dataset.remove);
    save();
    render();
    return;
  }
  const answer = ['tier', 'pick', 'white', 'instead'].find((a) => el.dataset[a]);
  if (answer && k) {
    const t = testOf(k);
    const r = runOf(k.id);
    const v = el.dataset[answer];
    if (answer === 'tier') r.pierre[t.pierre[r.i].id] = v;
    if (answer === 'pick') r.marco[t.marco[r.i].id] = v;
    if (answer === 'white') r.white[white(k).ladder[r.i].id] = v;
    if (answer === 'instead') r.instead = v;
    r.sent = false;
    save();
    renderKitchen(k);
    advanceT = setTimeout(() => { advance(k); save(); render(); }, 260);
    return;
  }
  const act = el.dataset.act;
  if (act === 'home') { current = null; render(); return; }
  if (act === 'add') {
    const found = loadKitchens(document.getElementById('paste').value);
    if (!found.length) { toast('No kitchen found in that text.'); return; }
    store.pasted = [...store.pasted.filter((p) => !found.some((f) => f.id === p.id)), ...found];
    save();
    toast(`Added ${found.length} kitchen${found.length > 1 ? 's' : ''}.`);
    render();
    return;
  }
  if (act === 'all') {
    const done = kitchens().filter((x) => store.runs[x.id]);
    if (!done.length) { toast('No answers yet.'); return; }
    download(`harveys-kitchen-tests-${new Date().toISOString().slice(0, 10)}.json`, done.map(resultOf));
    return;
  }
  if (act === 'wipe') {
    if (Date.now() - armed > 4000) { armed = Date.now(); el.textContent = 'Tap again to erase'; return; }
    store.runs = {};
    save();
    render();
    return;
  }
  if (!k) return;
  const r = runOf(k.id);
  if (act === 'send') {
    const res = resultOf(k);
    navigator.clipboard?.writeText(JSON.stringify(res)).then(() => toast('Copied, downloaded, and opening GitHub.'), () => {});
    download(`${k.id}.json`, res);
    r.sent = true;
    save();
    return;
  }
  if (act === 'next') {
    const list = kitchens();
    const nxt = list.find((x) => x.id !== k.id && store.runs[x.id]?.stage !== 'end');
    current = nxt?.id ?? null;
    if (!nxt) toast('Every kitchen is done.');
    render();
    return;
  }
  if (act === 'skip') advance(k);
  else if (act === 'back') { if (r.stage === 'end') Object.assign(r, { stage: 'instead', i: 0 }); else retreat(k); }
  else if (act === 'reset') {
    if (Date.now() - armed > 4000) { armed = Date.now(); el.textContent = 'Tap again to erase'; return; }
    delete store.runs[k.id];
  }
  save();
  render();
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'persona') { store.persona = e.target.value.trim() || DEFAULT_PERSONA; save(); }
});

load();
const params = new URLSearchParams(location.search);
// ?kitchens=<url> loads more kitchens from any JSON file (one or many).
const sources = ['data/test-kitchens/kitchens.json', params.get('kitchens')].filter(Boolean);
const loadCache = fetch('data/ingredient-cache.json')
  .then((res) => (res.ok ? res.json() : {}))
  .catch(() => ({}));
Promise.all([loadCache, ...sources.map((u) => fetch(u).then((res) => (res.ok ? res.text() : '[]')).catch(() => '[]'))])
  .then(([c, ...texts]) => { cache = c ?? {}; builtIn = texts.flatMap((t) => loadKitchens(t)); })
  .finally(() => { current = params.get('k'); render(); });
