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
