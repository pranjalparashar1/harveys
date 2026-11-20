// Pierre benchmark (v2 Step 4): 30 dishes, one per screen, rated veto, floor, pass or crave.
// Blind: the sheet holds names and parts only; the brain's tiers live in a key outside the
// repo. Answers save after every tap and go out by "Send to Harvey's" (a GitHub issue, and
// the clipboard).
import { encodeBench } from './quiz/bench.js';

const VERSION = '1.13.0';
const KEY = 'harveys.bench.v1';
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
      <p class="how">${esc(d.parts)}</p>
      <div class="opts" role="radiogroup" aria-label="Your tier">${sheet.tiers.map((t) => `
        <button type="button" class="opt centre${a.tier === t.id ? ' sel' : ''}" role="radio" aria-checked="${a.tier === t.id}" data-tier="${t.id}">
          <span class="ct"><b>${esc(t.label)}</b><small>${esc(t.line)}</small></span>
        </button>`).join('')}</div>
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
  const el = e.target.closest('[data-tier],[data-reason],[data-fixtier],[data-tiers],[data-act]');
  if (!el) return;
  const d = sheet.dishes[state.i];
  if (el.dataset.tier) {
    const a = state.answers[d.id] ?? {};
    const keep = el.dataset.tier === 'veto' || el.dataset.tier === 'floor';
    state.answers[d.id] = { tier: el.dataset.tier, reasons: keep ? (a.reasons ?? []) : [], ...(keep && a.fix ? { fix: a.fix } : {}), at: new Date().toISOString() };
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
    if (act === 'next') {
      if (!state.answers[d.id]?.tier) return toast('Pick a tier to go on.');
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
  const res = await fetch(new URL(`./quiz/benchmark.json${new URL(import.meta.url).search}`, import.meta.url));
  sheet = await res.json();
  load();
  state.i = Math.min(state.i, sheet.dishes.length);
  render();
}
init().catch((e) => { app.innerHTML = `<p class="error">${esc(e.message)}</p>`; });
