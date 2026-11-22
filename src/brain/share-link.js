// Kitchen share links (1.34.0): one link per kitchen, so a tester taps it in WhatsApp or
// iMessage and lands in the taste test with their own kitchen already loaded. No paste.
//
// The kitchen rides in the URL fragment (#k=…), so nothing is stored anywhere: no server, no
// relay, no repo write, and the link works the moment it's made. The fragment never reaches
// GitHub Pages, so the kitchen stays between the two phones.
//
//   kitchen → compact text (one line per item, "name~category") → deflate-raw → base64url
//
// A 58-item kitchen comes out near 800 characters: fine for WhatsApp, iMessage and SMS.
// base64url uses only A–Z a–z 0–9 - _, which no chat app breaks a link on.
// Prefix "1" is deflated; prefix "0" is the same text uncompressed (for a browser with no
// CompressionStream). Both decode everywhere CompressionStream exists (Safari 16.4+, Chrome 80+).

export const SITE = 'https://pranjalparashar1.github.io/harveys/';
const SEP = '~';
const clean = (s, n) => String(s ?? '').replace(/[\r\n~]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

const b64url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** A kitchen ({kitchen, diet, notes, items[{name, category}]}) → the compact text a link carries. */
export function packKitchen(k) {
  const items = (k.items ?? []).map((i) => (typeof i === 'string' ? { name: i } : i)).filter((i) => clean(i.name, 80));
  return [
    clean(k.kitchen, 80) || 'Kitchen',
    clean(k.diet, 20),
    clean(k.notes, 200),
    ...items.map((i) => `${clean(i.name, 80)}${i.category && i.category !== 'other' ? SEP + clean(i.category, 20) : ''}`),
  ].join('\n');
}

/** The compact text → a kitchen in the catalogue prompt's own shape. */
export function unpackKitchen(text) {
  const [kitchen, diet, notes, ...rows] = String(text).split('\n');
  return {
    kitchen: kitchen || 'Kitchen',
    diet: diet || 'unknown',
    notes: notes || '',
    items: rows.filter(Boolean).map((r) => { const [name, category] = r.split(SEP); return { name, category: category || 'other' }; }),
  };
}

/** A kitchen → the fragment value (no "#k="). */
export async function encodeKitchen(k) {
  const bytes = new TextEncoder().encode(packKitchen(k));
  if (typeof CompressionStream === 'undefined') return `0${b64url(bytes)}`;
  return `1${b64url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
}

/** The fragment value → a kitchen, or null if the link is broken or cut short. */
export async function decodeKitchen(code) {
  try {
    const s = String(code ?? '').trim();
    if (!/^[01][A-Za-z0-9_-]+$/.test(s)) return null;
    let bytes = unb64url(s.slice(1));
    if (s[0] === '1') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    const k = unpackKitchen(new TextDecoder().decode(bytes));
    return k.items.length ? k : null;
  } catch {
    return null; // a link cut off by a chat app fails to inflate: say so, don't guess
  }
}

/** A kitchen → its full share link. `name` (1.35.0) is the tester's first name: the page greets them with it. */
export async function kitchenLink(k, site = SITE, name = '') {
  return linkFor(await encodeKitchen(k), site, name);
}

/** An already-encoded kitchen + a name → the link (share.html re-links on every keystroke, no re-encode). */
export function linkFor(code, site = SITE, name = '') {
  const n = cleanName(name);
  return `${site}#${n ? `n=${encodeURIComponent(n)}&` : ''}k=${code}`;
}

/** A tester's name as the greeting shows it: one line, at most 40 characters. */
export const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/** The tester's name in a page's hash ("#n=Riya&k=…"), or ''. */
export function linkName(hash) {
  const m = /(?:^#|&)n=([^&]*)/.exec(String(hash ?? ''));
  if (!m) return '';
  try { return cleanName(decodeURIComponent(m[1].replace(/\+/g, ' '))); } catch { return cleanName(m[1]); }
}

/** A first-name guess from a kitchen label: "Riya, Bandra" → "Riya", "Sam’s kitchen" → "Sam". */
export function guessName(label) {
  const s = cleanName(label);
  const own = /^([^,’']{1,24})[’']s\b/.exec(s);
  if (own) return own[1].trim();
  const [first, rest] = s.split(',');
  if (rest !== undefined && first.trim().split(' ').length <= 2) return first.trim();
  return '';
}

/** The code in a page's hash ("#k=…", maybe beside other keys), or null. */
export function linkCode(hash) {
  const m = /(?:^#|&)k=([A-Za-z0-9_-]+)/.exec(String(hash ?? ''));
  return m ? m[1] : null;
}
