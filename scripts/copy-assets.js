// Copia los archivos del OCR (tesseract) a public/vendor para que funcionen sin internet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'vendor', 'tesseract');
const nm = (...p) => path.join(root, 'node_modules', ...p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'lang'), { recursive: true });

const copy = (from, to) => fs.copyFileSync(from, path.join(out, to));
copy(nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js');
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  copy(nm('tesseract.js-core', f), f);
}
copy(nm('@tesseract.js-data', 'spa', '4.0.0_best_int', 'spa.traineddata.gz'), 'lang/spa.traineddata.gz');
copy(nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'lang/eng.traineddata.gz');
console.log('OCR listo en', path.relative(root, out));
