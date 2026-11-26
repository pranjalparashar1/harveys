// Owner gate (1.35.0): pranjal's pages (owner.html, share, train, the trainers) ask for a
// password once per phone. A soft gate only: the site is static and its code is public, so
// this keeps testers out of the workbench, it doesn't keep secrets. Nothing secret lives here.
// A classic script in <head>, so a locked page never flashes its contents.
(function () {
  var KEY = 'harveys.owner.v1';
  var PASS = 'harveys';
  var DAYS = 30;
  var root = document.documentElement;
  function unlocked() {
    try { var t = Number(localStorage.getItem(KEY)); return t > 0 && Date.now() - t < DAYS * 864e5; } catch (e) { return false; }
  }
  window.harveysLock = function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    location.href = './';
  };
  if (unlocked()) return;
  root.classList.add('locked');
  function mount() {
    var box = document.createElement('form');
    box.className = 'gate';
    box.setAttribute('aria-label', 'Owner sign-in');
    box.innerHTML =
      '<p class="gate-eyebrow">Harvey’s</p>' +
      '<h1 class="gate-title">Hi, pranjal</h1>' +
      '<p class="gate-lead">This is the workbench. Password, please.</p>' +
      '<input class="gate-input" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" placeholder="Password" aria-label="Password" required>' +
      '<p class="gate-err" role="alert" hidden>Not that one.</p>' +
      '<button class="btn primary xl gate-go" type="submit">Open</button>' +
      '<a class="btn link gate-back" href="./">Back to Harvey’s</a>';
    document.body.prepend(box);
    var input = box.querySelector('input');
    var err = box.querySelector('.gate-err');
    input.focus();
    box.addEventListener('submit', function (e) {
      e.preventDefault();
      if (input.value.trim().toLowerCase() === PASS) {
        try { localStorage.setItem(KEY, String(Date.now())); } catch (x) { /* private mode: this visit only */ }
        root.classList.remove('locked');
        box.remove();
        return;
      }
      err.hidden = false;
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      if (navigator.vibrate) try { navigator.vibrate([12, 40, 12]); } catch (x) { /* none */ }
      input.select();
    });
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
