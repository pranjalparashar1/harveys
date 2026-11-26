// The one way a page scans kitchen photos (1.60.0). The home page calls only these two, so the
// Harvey's /scan relay (no key needed) can slot in here without touching the page: scanReady()
// says whether a scan can run, scanPhotos() runs it and returns the same items either way.
// Today: your own key (BYO, flash-lite only for Gemini), straight from the browser.
import { scanKitchen, AIError } from './providers.js';

/** Can a scan run now? ai: the saved { apiKey, provider, model, models } or null. */
export function scanReady(ai) {
  return !!ai?.apiKey;
}

/**
 * Photos ({ base64, mediaType }[]) → kitchen items [{ name, canonical, category }], with
 * items.model, items.photosRead and items.photosTotal. Throws an AIError on failure.
 */
export async function scanPhotos({ ai, images, deadlineMs = 12000, onEvent = () => {} }) {
  if (!scanReady(ai)) throw new AIError('noKey');
  return scanKitchen({ ...ai, images, deadlineMs, onEvent, onStatus: () => {} });
}
