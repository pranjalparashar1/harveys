// Shrinks photos before sending: phone photos are 3–12 MB, which is slow and
// can exceed provider limits once several go in one request.
//
// iPhone notes (Marco 1.1):
//   • The picker's FileList is copied to an array before the <input> is reset;
//     resetting first can empty the list on iOS Safari.
//   • createImageBitmap decodes off the main thread and honours EXIF rotation;
//     <img> is the fallback for older Safari.
//   • Photos are decoded one at a time so a burst of 12 MP images doesn't run
//     the tab out of memory.

export const MAX_SIDE = 640;
const QUALITY = 0.6;

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Revoke after the next frame so Safari has finished with it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** @param {File} file  @returns {Promise<{base64: string, mediaType: string, previewUrl: string, name: string}>} */
export async function prepareImage(file) {
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error(`Couldn't open ${file.name || 'a photo'}. Try a JPEG or a screenshot of it.`);
  }
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  canvas.width = canvas.height = 0; // free the backing store on iOS
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl, name: file.name };
}

// ── Video → keyframes (1.61.0) ──────────────────────────────────────────────
// A 10–30 s walk past the shelves and the open fridge becomes a handful of
// still frames, drawn and compressed exactly like photos. The raw video never
// leaves the phone: only the frames are sent.
//
// iPhone notes:
//   • the <video> must be muted + playsinline, or iOS refuses to decode it off-screen;
//   • iOS may report duration 0 or Infinity until it has read further, so a short
//     play/pause nudges it, and an unknown length falls back to 4 frames over 12 s;
//   • one canvas is reused and zeroed after each frame, so 8 frames never hold 8
//     full backing stores at once.

export const MAX_FRAMES = 8;

/** Seconds to grab: n = clamp(ceil(duration / 3), 4, maxFrames), evenly spread over [0.5, duration − 0.5]. Pure. */
export function keyframeTimes(duration, maxFrames = MAX_FRAMES) {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 12;
  const n = Math.max(1, Math.min(maxFrames, Math.max(4, Math.ceil(d / 3))));
  const lo = Math.min(0.5, d / 2);
  const hi = Math.max(lo, d - 0.5);
  if (n === 1 || hi === lo) return [lo];
  // A very short clip has fewer distinct moments than frames: keep them ≥ 0.25 s apart.
  const count = Math.max(1, Math.min(n, Math.floor((hi - lo) / 0.25) + 1));
  if (count === 1) return [lo];
  return Array.from({ length: count }, (_, i) => +(lo + ((hi - lo) * i) / (count - 1)).toFixed(3));
}

/** True for a video file from the camera roll (by type, or by extension when iOS leaves the type empty). */
export function isVideo(file) {
  return /^video\//.test(file?.type ?? '') || (!file?.type && /\.(mov|mp4|m4v|webm|3gp)$/i.test(file?.name ?? ''));
}

function once(target, ok, ms, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timed out waiting for ${what}`)); }, ms);
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`video error while waiting for ${what}`)); };
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(ok, done); target.removeEventListener('error', fail); };
    target.addEventListener(ok, done);
    target.addEventListener('error', fail);
  });
}

/**
 * @param {File} file a short kitchen video
 * @returns {Promise<Array<{base64: string, mediaType: string, previewUrl: string, name: string}>>} same shape as prepareImage()
 */
export async function extractVideoKeyframes(file, { maxFrames = MAX_FRAMES, maxSide = MAX_SIDE, quality = QUALITY } = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.preload = 'metadata';
  const canvas = document.createElement('canvas');
  const label = file.name || 'video';
  try {
    const meta = once(video, 'loadedmetadata', 10000, 'the video to open');
    video.src = url;
    await meta;
    let duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      // iOS sometimes knows the length only once it has started reading.
      try { await video.play(); video.pause(); } catch { /* autoplay refused: use the fallback */ }
      duration = video.duration;
    }
    if (!video.videoWidth || !video.videoHeight) await once(video, 'loadeddata', 5000, 'the first frame').catch(() => {});
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('no picture');
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const frames = [];
    for (const [i, t] of keyframeTimes(duration, maxFrames).entries()) {
      const seeked = once(video, 'seeked', 5000, `frame ${i + 1}`);
      video.currentTime = t;
      try { await seeked; } catch { continue; } // one bad seek loses one frame, not the video
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      canvas.width = canvas.height = 0; // free the backing store on iOS between frames
      if (!dataUrl.startsWith('data:image/jpeg')) continue;
      frames.push({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl, name: `${label} @${t.toFixed(1)}s` });
    }
    if (!frames.length) throw new Error('no frames');
    return frames;
  } catch {
    throw new Error(`Couldn't read ${label}. Try a shorter clip, or photos.`);
  } finally {
    video.removeAttribute('src');
    try { video.load(); } catch { /* not in every browser */ }
    canvas.width = canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}

/** A photo or a video, prepared: always an array of frames ready to send. */
export async function prepareMedia(file, opts = {}) {
  return isVideo(file) ? extractVideoKeyframes(file, opts) : [await prepareImage(file)];
}
