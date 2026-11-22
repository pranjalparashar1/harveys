// share.html (1.34.0): paste or upload the video agent's kitchen JSON, get one taste-test link
// per kitchen, and send it on WhatsApp or iMessage in one tap. The kitchen rides in the link
// itself (src/brain/share-link.js), so nothing is uploaded and every link works at once.
import { importKitchens, buildInventory } from './brain/index.js';
import { buildRungQuiz } from './brain/rung-quiz.js';
import { kitchenLink } from './brain/share-link.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = new URL('./', location.href).href; // "Try it" opens on this copy of the site
const PUBLIC = /github\.io/.test(location.host) ? SITE : 'https://pranjalparashar1.github.io/harveys/';
const DEFAULT_MSG = 'Hi! Here’s your Harvey’s taste test, made from your kitchen video. It takes a few minutes and it’s all taps:\n{link}';
const KEYS = { text: 'harveys.share.text', msg: 'harveys.share.msg' };
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };
const buzz = () => { if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* none */ } };

let made = [];
const message = (link) => ($('msg').value || DEFAULT_MSG).replace('{link}', link);

/** One kitchen → what its tester will see, so a thin kitchen is caught before it's sent. */
function preview(k) {
  const quiz = buildRungQuiz({ kitchen: k, inventory: buildInventory(k.items) });
  const dishes = Object.keys(quiz.dishes).length;
  const questions = quiz.steps.length;
  const minutes = Math.max(2, Math.round((questions * 15 + 60) / 60));
  return { dishes, questions, rounds: quiz.rungs.length, minutes };
}

async function make() {
  const text = $('kitchens').value.trim();
  const err = $('err');
  err.hidden = true;
  if (!text) { $('kitchens').focus(); return; }
  const kitchens = importKitchens(text);
  if (!kitchens.length) {
    err.textContent = 'No kitchen found in that. It needs {"kitchen": "…", "items": [{"name": "…"}]}, one object per kitchen.';
    err.hidden = false;
    $('out').replaceChildren();
    return;
  }
  set(KEYS.text, text);
  made = await Promise.all(kitchens.map(async (k) => ({ k, link: await kitchenLink(k, PUBLIC), local: await kitchenLink(k, SITE), ...preview(k) })));
  render();
}

function render() {
  const cards = made.map((m, i) => {
    const thin = m.dishes < 4;
    return `
    <article class="card kcard" style="animation-delay:${i * 0.05}s">
      <h3>${esc(m.k.kitchen)}</h3>
      <ul class="kmeta">
        <li>${m.k.items.length} items</li>
        <li class="${thin ? 'warn' : ''}">${m.dishes} dish${m.dishes === 1 ? '' : 'es'}</li>
        <li>${m.questions} questions</li>
        <li>about ${m.minutes} min</li>
        ${m.k.diet && m.k.diet !== 'unknown' ? `<li>${esc(m.k.diet)}</li>` : ''}
      </ul>
      ${thin ? '<p class="kwarn">Too few dishes for a good test. Check the list for missing staples before sending.</p>' : ''}
      ${m.k.notes ? `<p class="mini">${esc(m.k.notes)}</p>` : ''}
      <a class="klink" href="${esc(m.local)}" target="_blank" rel="noopener">${esc(m.link)}</a>
      <div class="kacts">
        <button class="btn primary" data-act="share" data-i="${i}" type="button">${navigator.share ? 'Share' : 'Copy message'}</button>
        <a class="btn" href="https://wa.me/?text=${encodeURIComponent(message(m.link))}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="btn" href="sms:&amp;body=${encodeURIComponent(message(m.link))}">Messages</a>
        <button class="btn" data-act="copy" data-i="${i}" type="button">Copy link</button>
        <a class="btn" href="${esc(m.local)}" target="_blank" rel="noopener">Try it</a>
      </div>
    </article>`;
  });
  const all = made.length > 1 ? `<div class="all-row"><button class="btn" data-act="all" type="button">Copy all ${made.length} links</button></div>` : '';
  $('out').innerHTML = all + cards.join('');
}

async function copy(text, btn, label) {
  try { await navigator.clipboard.writeText(text); } catch { prompt('Copy this', text); return; }
  const was = btn.textContent;
  btn.textContent = label;
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = was; btn.classList.remove('done'); }, 1600);
}

$('out').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  buzz();
  const m = made[Number(b.dataset.i)];
  if (b.dataset.act === 'copy') return copy(m.link, b, 'Copied');
  if (b.dataset.act === 'all') return copy(made.map((x) => `${x.k.kitchen}\n${x.link}`).join('\n\n'), b, 'Copied');
  if (b.dataset.act === 'share') {
    // Text only: WhatsApp and Messages both keep the link inside the text and preview it.
    if (navigator.share) { try { await navigator.share({ text: message(m.link) }); } catch { /* cancelled */ } return; }
    return copy(message(m.link), b, 'Copied');
  }
});

$('make').addEventListener('click', () => { buzz(); make(); });
$('file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  $('kitchens').value = await f.text();
  e.target.value = '';
  make();
});
$('msg').value = get(KEYS.msg) ?? DEFAULT_MSG;
$('msg').addEventListener('input', () => { set(KEYS.msg, $('msg').value === DEFAULT_MSG ? null : $('msg').value); if (made.length) render(); });
$('msg-reset').addEventListener('click', () => { $('msg').value = DEFAULT_MSG; set(KEYS.msg, null); if (made.length) render(); });

const last = get(KEYS.text);
if (last) { $('kitchens').value = last; make(); }
