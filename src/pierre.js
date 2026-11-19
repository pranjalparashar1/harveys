// Pierre-trainer (1.5.1): Kiron's quiz player, for food. One raw food per
// screen, no photos, rated in three steps: texture (0–3 each), taste (tap what's there),
// and how central it is to a meal (1–5). No right answers, no streaks, no
// timer; Back returns to the previous screen. Every tap toggles. "Send to Marco" hands the ratings
// over as text that scripts/ingest-pierre.mjs writes into the brain file.
import {
  STEPS, validateQuiz, blankState, startRound, tapTexture, tapTaste, tapCentre, tapPrep,
  canAdvance, advance, back, canGoBack, roundOver, unsent, markSent, encodePayload,
} from './quiz/quiz.js';

const VERSION = '1.5.2';
const RENAMED = { protein_bread: 'bread' };
const KEY = 'marco.pierre.v1';
const REPO_ISSUE = 'https://github.com/pranjalparashar1/marco/issues/new';
const app = document.getElementById('app');

let quiz = null;
let state = blankState();
let dir = 0; // 1 when a new screen slides in

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HX = '<input type="checkbox" switch class="haptic" tabindex="-1" aria-hidden="true">';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function load() {
  try { state = { ...blankState(), ...JSON.parse(localStorage.getItem(KEY)) }; } catch { state = blankState(); }
  // Foods that left the quiz (protein bread became plain bread in 1.5.2): their old
  // answers aren't sent, and a saved round asks the replacement instead.
  const known = new Set(quiz.foods.map((f) => f.id));
  for (const id of Object.keys(state.answers)) if (!known.has(id)) delete state.answers[id];
  if (state.round) state.round = { ...state.round, ids: state.round.ids.map((id) => RENAMED[id] ?? id) };
  // A saved round whose foods are gone from the quiz restarts cleanly.
  if (state.round && !state.round.ids.every((id) => quiz.foods.some((f) => f.id === id))) state.round = null;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('This phone can’t save right now.'); }
}
const food = (id) => quiz.foods.find((f) => f.id === id);

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

// ── Screens ─────────────────────────────────────────────────────────────────
function render() {
  if (location.hash === '#play' && state.round) return roundOver(state) ? renderEnd() : renderPlay();
  renderHome();
}

function renderHome() {
  document.title = 'Pierre-trainer';
  const total = quiz.foods.length;
  const rated = quiz.foods.filter((f) => state.answers[f.id]).length;
  const inRound = state.round && !roundOver(state);
  const left = total - rated;
  const toSend = unsent(state).length;
  app.innerHTML = `
  <header class="top"><div class="top-in">
    <a class="icon-btn" href="train.html" aria-label="Back to Train">‹</a>
    <h1>Pierre-trainer</h1>
  </div></header>
  <main class="wrap quiz-home">
    <div class="meter" role="img" aria-label="${rated} of ${total} foods rated"><i style="transform:scaleX(${(rated / total).toFixed(3)})"></i></div>
    ${left ? `<button class="btn primary xl" data-act="${inRound ? 'resume' : 'begin'}" type="button">${inRound ? 'Keep going' : rated ? 'Next round' : 'Begin'}${HX}</button>` : ''}
    ${rated ? sendLink(toSend, !left) : ''}
    ${rated ? `<button class="btn link quiet reset" data-act="reset" type="button">Start over</button>` : ''}
    <p class="mini center version">Marco ${VERSION} · Pierre-trainer</p>
  </main>`;
}

function sendLink(toSend, primary) {
  const body = encodePayload(quiz, state.answers);
  const n = Object.keys(state.answers).length;
  const href = `${REPO_ISSUE}?${new URLSearchParams({ title: `Pierre-trainer: ${n} foods`, labels: 'pierre-trainer', body: '```\n' + body + '\n```' })}`;
  return `<a class="btn${primary ? ' primary xl' : ''} send${toSend ? ' fresh' : ''}" data-act="send" href="${esc(href)}" target="_blank" rel="noopener">Send to Marco</a>`;
}

function renderPlay() {
  const r = state.round;
  const f = food(r.ids[r.i]);
  const step = STEPS[r.step];
  const d = r.draft;
  document.title = `${f.name} · Pierre-trainer`;
  const dots = r.ids.map((_, i) => `<i class="${i < r.i ? 'past' : i === r.i ? 'now' : ''}"${i === r.i ? ` style="--p:${((r.step + 1) / STEPS.length).toFixed(3)}"` : ''}></i>`).join('');
  let input = '';
  if (step === 'texture') {
    input = `<h2 class="step">Texture</h2><div class="rates">` + quiz.textures.map((t) => `
      <div class="rate"><span class="rate-label">${esc(t.label)}</span>
        <div class="segmented levels" role="radiogroup" aria-label="${esc(t.label)}">${quiz.levels.map((w, lv) =>
          `<button type="button" role="radio" aria-checked="${d.texture[t.id] === lv}" data-tex="${t.id}" data-lv="${lv}">${esc(w)}</button>`).join('')}</div>
      </div>`).join('') + `</div>`;
  } else if (step === 'taste') {
    const main = quiz.tastes.filter((t) => !t.bonus);
    const bonus = quiz.tastes.filter((t) => t.bonus);
    const opt = (t) => `<button type="button" class="opt${d.taste[t.id] ? ' sel' : ''}" data-taste="${t.id}" aria-pressed="${!!d.taste[t.id]}"><span class="k box">${d.taste[t.id] ? '✓' : ''}</span><span>${esc(t.label)}</span></button>`;
    input = `<h2 class="step">Taste</h2><div class="opts grid2" role="group" aria-label="Taste">${main.map(opt).join('')}</div>`
      + (bonus.length ? `<h2 class="step bonus">Bonus</h2><div class="opts grid2" role="group" aria-label="Bonus">${bonus.map(opt).join('')}</div>` : '');
  } else {
    input = `<h2 class="step">How central?</h2><div class="opts" role="radiogroup" aria-label="How central">` + quiz.centre.map((c) => `
      <button type="button" class="opt centre${d.centre === c.value ? ' sel' : ''}" role="radio" aria-checked="${d.centre === c.value}" data-centre="${c.value}">
        <span class="k">${c.value}</span><span class="ct"><b>${esc(c.label)}</b><small>${esc(c.line)}</small></span>
      </button>`).join('') + `</div>`;
  }
  if (d.prep) input = `<div class="prep-dim" aria-hidden="true">${input}</div>`;
  input += `<button type="button" class="opt prep${d.prep ? ' sel' : ''}" data-prep="1" aria-pressed="${d.prep}"><span class="k box">${d.prep ? '✓' : ''}</span><span class="ct"><b>Part of prep</b><small>Needs further processing</small></span></button>`;
  const last = r.i + 1 >= r.ids.length;
  const nextLabel = step !== 'centre' && !d.prep ? 'Next' : last ? 'Finish round' : 'Next food';
  const ok = canAdvance(r.step, d);
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <a class="icon-btn" href="#" aria-label="Leave this round">✕</a>
    <div class="dots" role="img" aria-label="Food ${r.i + 1} of ${r.ids.length}">${dots}</div>
  </div></header>
  <main class="wrap play">
    <article class="qcardp${reduceMotion() ? '' : dir > 0 ? ' in-next' : dir < 0 ? ' in-prev' : ''}">
      <h1 class="prompt" tabindex="-1">${esc(f.name)}</h1>
      ${input}
    </article>
  </main>
  <div class="actionbar"><div class="actionbar-in">
    ${canGoBack(state) ? `<button class="btn ghost back" data-act="back" type="button" aria-label="Back">‹</button>` : ''}
    <button class="btn primary grow${ok ? '' : ' soft'}" data-act="next" type="button" aria-disabled="${!ok}">${nextLabel}${HX}</button>
  </div></div>`;
  dir = 0;
}

function renderEnd() {
  const r = state.round;
  const left = quiz.foods.some((f) => !state.answers[f.id]);
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <a class="icon-btn" href="#" aria-label="Back">✕</a>
    <div class="dots" role="img" aria-label="Round finished">${r.ids.map(() => '<i class="past"></i>').join('')}</div>
  </div></header>
  <main class="wrap play"><div class="endcard">
    <h1 class="prompt">${left ? 'Round done' : 'Every food rated'}</h1>
    <div class="tiles">${r.ids.map((id) => tile(food(id))).join('')}</div>
    <div class="cta">
      ${left ? `<button class="btn primary xl" data-act="begin" type="button">Keep going${HX}</button>` : ''}
      ${sendLink(unsent(state).length, !left)}
      <button class="btn ghost" data-act="back" type="button">Back to ${esc(food(r.ids[r.ids.length - 1]).name)}</button>
    </div>
  </div></main>`;
}

function tile(f) {
  const a = state.answers[f.id];
  return `<div class="tile"><b>${esc(f.name)}</b><span class="c${a?.prep ? ' prep' : ''}">${a?.prep ? 'P' : a?.centre ?? ''}</span></div>`;
}

// ── Taps ────────────────────────────────────────────────────────────────────
function patch(fn) {
  state.round = { ...state.round, draft: fn(state.round.draft) };
  save();
  const y = scrollY;
  renderPlay();
  scrollTo(0, y);
}

let armed = 0;
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tex],[data-taste],[data-centre],[data-prep],[data-act]');
  if (!el) return;
  if (el.dataset.prep) return patch((d) => tapPrep(d));
  if (el.closest('.prep-dim')) return;
  if (el.dataset.tex) return patch((d) => tapTexture(d, el.dataset.tex, Number(el.dataset.lv)));
  if (el.dataset.taste) return patch((d) => tapTaste(d, el.dataset.taste));
  if (el.dataset.centre) return patch((d) => tapCentre(d, Number(el.dataset.centre)));
  const act = el.dataset.act;
  if (act === 'back') {
    state = back(quiz, state);
    save();
    dir = -1;
    if (location.hash !== '#play') location.hash = 'play'; else { render(); scrollTo(0, 0); }
  } else if (act === 'next') {
    if (!canAdvance(state.round.step, state.round.draft)) return toast('Pick one to go on.');
    state = advance(quiz, state);
    save();
    dir = 1;
    render();
    scrollTo(0, 0);
    app.querySelector('.prompt')?.focus({ preventScroll: true });
  } else if (act === 'begin') {
    state = startRound(quiz, state);
    save();
    dir = 1;
    if (location.hash === '#play') { render(); scrollTo(0, 0); } else location.hash = 'play';
  } else if (act === 'resume') {
    location.hash = 'play';
  } else if (act === 'send') {
    // The link opens a prefilled GitHub issue; the same text goes to the clipboard to paste to Claude.
    const text = encodePayload(quiz, state.answers);
    navigator.clipboard?.writeText(text).then(() => toast('Copied, and opening GitHub.'), () => {});
    state = markSent(state, Object.keys(state.answers));
    save();
    setTimeout(render, 300);
  } else if (act === 'reset') {
    if (Date.now() - armed > 4000) { armed = Date.now(); el.textContent = 'Tap again to erase'; el.classList.add('armed'); return; }
    state = blankState();
    save();
    render();
  }
});
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
document.addEventListener('click', (e) => {
  if (e.target.closest?.('.haptic') && !('switch' in HTMLInputElement.prototype) && navigator.vibrate) navigator.vibrate(8);
});

async function init() {
  const res = await fetch(new URL(`./quiz/pierre-trainer.json${new URL(import.meta.url).search}`, import.meta.url));
  quiz = validateQuiz(await res.json());
  load();
  render();
}
init().catch((e) => { app.innerHTML = `<p class="error">${esc(e.message)}</p>`; });
