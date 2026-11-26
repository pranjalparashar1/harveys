// The one way a page scans kitchen photos (1.60.0). The home page calls only these, so the
// way a scan runs can change without touching the page: scanReady() says whether a scan can
// run, scanPhotos() runs it and returns the same items either way.
//   • Your own key (BYO, flash-lite only for Gemini), straight from the browser, comes first.
//   • 1.61.0: otherwise Harvey's free scan, POST /scan on the relay (relay/scan.js), which asks
//     Gemini flash-lite with Harvey's own key. 3 a day per connection.
import { scanKitchen, scanViaRelay, AIError } from './providers.js';
import { relayUrl } from '../send.js';

let free = null; // null: not asked yet; true/false: the relay's GET / said so

/** Asks the relay once whether the free scan is on ({ scan: true } once GEMINI_API_KEY is set). */
export async function checkFreeScan({ fetchImpl = fetch, relay = relayUrl(), timeoutMs = 4000 } = {}) {
  if (free !== null || !relay) return !!free && !!relay;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(relay, { signal: controller.signal, cache: 'no-store' });
    free = res.ok && (await res.json())?.scan === true;
  } catch {
    return false; // offline: ask again next time
  } finally {
    clearTimeout(timer);
  }
  return free;
}
/** For tests: forget what the relay said. */
export function resetFreeScan(value = null) { free = value; }

/** Can a scan run now? ai: the saved { apiKey, provider, model, models } or null. */
export function scanReady(ai) {
  return !!ai?.apiKey || (free === true && !!relayUrl());
}

/** True when the next scan goes through the free scan rather than your own key. */
export const usesFreeScan = (ai) => !ai?.apiKey && free === true && !!relayUrl();

/**
 * Photos ({ base64, mediaType }[]) → kitchen items [{ name, canonical, category }], with
 * items.model, items.photosRead and items.photosTotal. Throws an AIError on failure
 * (freeLimit and scanOff for the free scan).
 */
export async function scanPhotos({ ai, images, deadlineMs = 12000, onEvent = () => {}, fetchImpl }) {
  if (ai?.apiKey) return scanKitchen({ ...ai, images, deadlineMs, onEvent, onStatus: () => {}, ...(fetchImpl ? { fetchImpl } : {}) });
  if (!usesFreeScan(ai)) throw new AIError('noKey');
  return scanViaRelay({ images, relay: relayUrl(), onEvent, ...(fetchImpl ? { fetchImpl } : {}) });
}
