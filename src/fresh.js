// "Start fresh" (1.40.0): one tap that clears what this phone remembers about a taste test,
// drops any cached copies of the site, and opens the link again from the network.
// Kept: unsent results (the outbox), the send token and relay, the AI key, the owner's
// password, and the old stored tester name (unused from 1.47.1). Pure enough to test: storage and the page are passed in.

/** What a fresh start forgets: the saved quiz runs and the kitchen the page last showed. */
export const FRESH_KEYS = Object.freeze([
  'harveys.rq.v1',
  'marco.inventory', 'marco.pantry', 'marco.missingBasics', 'marco.soaked', 'marco.context',
]);

/** Clears the keys, session storage, Cache Storage and any service worker. Never throws. */
export async function clearLocal({ ls = globalThis.localStorage, ss = globalThis.sessionStorage, caches = globalThis.caches, sw = globalThis.navigator?.serviceWorker } = {}) {
  for (const k of FRESH_KEYS) { try { ls?.removeItem(k); } catch { /* private mode */ } }
  try { ss?.clear(); } catch { /* private mode */ }
  try { if (caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k))); } catch { /* none */ }
  try { if (sw) await Promise.all((await sw.getRegistrations()).map((r) => r.unregister())); } catch { /* none */ }
}

/** The same page and link, with a new query so the browser fetches the page again. */
export function freshUrl(loc, now = Date.now()) {
  return `${loc.pathname}?fresh=${now.toString(36)}${loc.hash ?? ''}`;
}

export async function startFresh(loc = globalThis.location) {
  await clearLocal();
  loc.replace(freshUrl(loc));
}

/**
 * A page from an older build (the browser kept index.html up to 10 minutes): reload once
 * when version.json names a newer build. Only on the deployed site, where pages carry data-build.
 */
export async function reloadIfStale(doc = globalThis.document, loc = globalThis.location, ss = globalThis.sessionStorage) {
  const mine = doc?.documentElement?.dataset?.build;
  if (!mine) return false;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const { build } = await res.json();
    if (!build || build === mine) return false;
    const tried = `harveys.reload.${build}`;
    if (ss?.getItem(tried)) return false; // once per build, never a loop
    ss?.setItem(tried, '1');
    loc.replace(freshUrl(loc));
    return true;
  } catch { return false; }
}
