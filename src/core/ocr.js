// Reconocimiento de texto (OCR) en tu computadora con tesseract.js. Español + inglés, sin internet.
import { createWorker } from 'tesseract.js';

let workerPromise = null;

function base() {
  return new URL('vendor/tesseract/', document.baseURI).toString();
}

export function getOcrWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = createWorker(['spa', 'eng'], 1, {
      workerPath: `${base()}worker.min.js`,
      corePath: base(),
      langPath: `${base()}lang`,
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === 'recognizing text' && workerPromise.onProgress) workerPromise.onProgress(m.progress);
      },
    });
  }
  workerPromise.onProgress = onProgress || null;
  return workerPromise;
}

/**
 * @param {HTMLCanvasElement|HTMLImageElement|Blob} image
 * @returns {Promise<object>} página de tesseract con bloques, párrafos, líneas y palabras
 */
export async function recognize(image, onProgress) {
  const wp = getOcrWorker(onProgress);
  const worker = await wp;
  wp.onProgress = onProgress || null;
  const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
  return data;
}

/** Precarga el OCR para que la primera activación sea rápida. */
export function warmUpOcr() {
  getOcrWorker().catch(() => {
    workerPromise = null;
  });
}
