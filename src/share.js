// share.html (1.34.0): paste or upload the video agent's kitchen JSON, get one taste-test link
// per kitchen, and send it on WhatsApp or iMessage in one tap. The kitchen rides in the link
// itself (src/brain/share-link.js), so nothing is uploaded and every link works at once.
import { importKitchens, buildInventory } from './brain/index.js';
import { buildRungQuiz } from './brain/rung-quiz.js';
import { encodeKitchen, linkFor, guessName, cleanName } from './brain/share-link.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = new URL('./', location.href).href; // "Try it" opens on this copy of the site
const PUBLIC = /github\.io/.test(location.host) ? SITE : 'https://pranjalparashar1.github.io/harveys/';
const DEFAULT_MSG = 'Hi {name}! Here’s your Harvey’s taste test, made from your kitchen video. It takes a few minutes and it’s all taps:\n{link}';
const KEYS = { text: 'harveys.share.text', msg: 'harveys.share.msg', names: 'harveys.share.names' };
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };
const buzz = () => { if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* none */ } };

let made = [];
// 1.35.0: each link carries its tester's first name, so the page opens on "Hi, Riya".
const names = (() => { try { return JSON.parse(get(KEYS.names)) ?? {}; } catch { return {}; } })();
const link = (m, site = PUBLIC) => linkFor(m.code, site, m.name);
const message = (m) => {
  const t = ($('msg').value || DEFAULT_MSG).replace('{link}', link(m));
  return m.name ? t.replace(/\{name\}/g, m.name) : t.replace(/ \{name\}|\{name\},? ?/g, '');
};

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
  made = await Promise.all(kitchens.map(async (k) => ({ k, code: await encodeKitchen(k), name: names[k.kitchen] ?? guessName(k.kitchen), ...preview(k) })));
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
      <label class="kname"><span>Who’s it for?</span><input type="text" data-i="${i}" value="${esc(m.name)}" placeholder="First name" autocomplete="off" autocapitalize="words" enterkeyhint="done" maxlength="40"></label>
      <p class="mini khi" data-i="${i}"></p>
      <a class="klink" data-i="${i}" target="_blank" rel="noopener"></a>
      <div class="kacts">
        <button class="btn primary" data-act="share" data-i="${i}" type="button">${navigator.share ? 'Share' : 'Copy message'}</button>
        <a class="btn" data-wa="${i}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="btn" data-sms="${i}">Messages</a>
        <button class="btn" data-act="copy" data-i="${i}" type="button">Copy link</button>
        <a class="btn" data-try="${i}" target="_blank" rel="noopener">Try it</a>
      </div>
    </article>`;
  });
  const all = made.length > 1 ? `<div class="all-row"><button class="btn" data-act="all" type="button">Copy all ${made.length} links</button></div>` : '';
  $('out').innerHTML = all + cards.join('');
  made.forEach((_, i) => paint(i));
}

/** One card's links, redone in place on every keystroke of the name (keeps the keyboard up). */
function paint(i) {
  const m = made[i];
  const q = (sel) => $('out').querySelector(sel);
  const a = q(`.klink[data-i="${i}"]`);
  a.href = link(m, SITE);
  a.textContent = link(m);
  q(`[data-wa="${i}"]`).href = `https://wa.me/?text=${encodeURIComponent(message(m))}`;
  // "sms:?&body=" is the one form both iPhone and Android Messages fill in
  q(`[data-sms="${i}"]`).href = `sms:?&body=${encodeURIComponent(message(m))}`;
  q(`[data-try="${i}"]`).href = link(m, SITE);
  q(`.khi[data-i="${i}"]`).textContent = m.name ? `Opens on “Hi, ${m.name}”.` : 'No name: it opens on “Hi there”.';
}

$('out').addEventListener('input', (e) => {
  const input = e.target.closest('.kname input');
  if (!input) return;
  const m = made[Number(input.dataset.i)];
  m.name = cleanName(input.value);
  names[m.k.kitchen] = m.name;
  set(KEYS.names, JSON.stringify(names));
  paint(Number(input.dataset.i));
});

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
  if (b.dataset.act === 'copy') return copy(link(m), b, 'Copied');
  if (b.dataset.act === 'all') return copy(made.map((x) => `${x.k.kitchen}${x.name ? ` (${x.name})` : ''}\n${link(x)}`).join('\n\n'), b, 'Copied');
  if (b.dataset.act === 'share') {
    // Text only: WhatsApp and Messages both keep the link inside the text and preview it.
    if (navigator.share) { try { await navigator.share({ text: message(m) }); } catch { /* cancelled */ } return; }
    return copy(message(m), b, 'Copied');
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
$('msg').addEventListener('input', () => { set(KEYS.msg, $('msg').value === DEFAULT_MSG ? null : $('msg').value); made.forEach((_, i) => paint(i)); });
$('msg-reset').addEventListener('click', () => { $('msg').value = DEFAULT_MSG; set(KEYS.msg, null); made.forEach((_, i) => paint(i)); });

const last = get(KEYS.text);
if (last) { $('kitchens').value = last; make(); }
