// Shrinks photos before sending: phone photos are 3–12 MB, which is slow and
// can exceed provider limits once several go in one request.

const MAX_SIDE = 1280;
const QUALITY = 0.8;

/** @param {File} file  @returns {Promise<{base64: string, mediaType: string, previewUrl: string}>} */
export async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}
