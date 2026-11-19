// Food photos from Wikimedia Commons, looked up live and credited.
// Each food names its photo by a Wikipedia article (its lead image), a Commons
// search, or an exact Commons file. Only openly licensed images are used (CC0,
// public domain, CC BY, CC BY-SA); the author and licence travel with the URL
// and are shown under the photo. Lookups are cached in this browser for 30 days.

const WIDTH = 720;
const KEY = 'marco.pierre.photos.v1';
const TTL = 30 * 24 * 3600 * 1000;
const OPEN = /^(cc0|public domain|pd\b|cc[ -]by(-sa)?[ -]\d)/i;

export const isOpenLicence = (name) => OPEN.test(String(name ?? '').trim());
export const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const specKey = (p) => JSON.stringify(p);

function readCache() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function writeCache(c) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
}

async function api(host, params, signal) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${host} ${r.status}`);
  return r.json();
}

/** Turns one Commons imageinfo page into a photo record, or null if it isn't usable. */
export function toPhoto(page) {
  const ii = page?.imageinfo?.[0];
  if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime ?? '')) return null;
  const m = ii.extmetadata ?? {};
  const licence = stripHtml(m.LicenseShortName?.value);
  if (!isOpenLicence(licence)) return null;
  return {
    src: ii.thumburl || ii.url,
    page: ii.descriptionurl,
    author: stripHtml(m.Artist?.value).slice(0, 80) || 'Unknown',
    licence,
  };
}

async function imageInfo(titles, signal) {
  if (!titles.length) return [];
  const j = await api('commons.wikimedia.org', { action: 'query', prop: 'imageinfo', titles: titles.join('|'), iiprop: 'url|extmetadata|mime', iiurlwidth: String(WIDTH) }, signal);
  return j.query?.pages ?? [];
}

/** Looks up photos for these foods. Resolves to { id: photo|null }. Never throws. */
export async function photosFor(foods, { signal } = {}) {
  const cache = readCache();
  const fresh = (f) => cache[f.id] && cache[f.id].spec === specKey(f.photo) && Date.now() - cache[f.id].t < TTL;
  const todo = foods.filter((f) => !fresh(f));
  try {
    // Wikipedia lead images: one call for every article, then one for their licences.
    const wiki = todo.filter((f) => f.photo.wiki);
    const files = new Map(todo.filter((f) => f.photo.file).map((f) => [f.id, f.photo.file]));
    for (let i = 0; i < wiki.length; i += 40) {
      const part = wiki.slice(i, i + 40);
      const j = await api('en.wikipedia.org', { action: 'query', prop: 'pageimages', piprop: 'name', titles: part.map((f) => f.photo.wiki).join('|'), redirects: '1' }, signal);
      const back = new Map();
      for (const r of [...(j.query?.normalized ?? []), ...(j.query?.redirects ?? [])]) back.set(r.to, back.get(r.from) ?? r.from);
      for (const p of j.query?.pages ?? []) {
        if (!p.pageimage) continue;
        const asked = back.get(p.title) ?? p.title;
        for (const f of part) if (f.photo.wiki === asked || f.photo.wiki === p.title) files.set(f.id, `File:${p.pageimage}`);
      }
    }
    const pages = [];
    const titles = [...new Set(files.values())];
    for (let i = 0; i < titles.length; i += 40) pages.push(...(await imageInfo(titles.slice(i, i + 40), signal)));
    for (const [id, title] of files) {
      const page = pages.find((p) => p.title === title || p.title.replace(/_/g, ' ') === title.replace(/_/g, ' '));
      const food = todo.find((f) => f.id === id);
      cache[id] = { spec: specKey(food.photo), t: Date.now(), photo: toPhoto(page) };
    }
    // Commons searches: the first openly licensed hit.
    await Promise.all(todo.filter((f) => f.photo.search).map(async (f) => {
      const j = await api('commons.wikimedia.org', { action: 'query', generator: 'search', gsrsearch: `${f.photo.search} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '8', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: String(WIDTH) }, signal);
      const hits = (j.query?.pages ?? []).sort((a, b) => a.index - b.index);
      cache[f.id] = { spec: specKey(f.photo), t: Date.now(), photo: hits.map(toPhoto).find(Boolean) ?? null };
    }));
    // Anything the lookups didn't answer stays unknown, to try again next time.
  } catch { /* offline or rate-limited: use what's cached */ }
  writeCache(cache);
  return Object.fromEntries(foods.map((f) => [f.id, cache[f.id]?.photo ?? null]));
}
