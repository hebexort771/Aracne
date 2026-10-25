// ¿Cuánto bajó la página entre dos capturas? Compara filas de píxeles (en gris) y busca el
// desplazamiento vertical que mejor las alinea. Ignora lo que no se movió (barras fijas,
// menús), así funciona aunque el navegador tenga cabecera o la app tenga barras laterales.
// Módulo puro (sin DOM) para poder probarlo con node --test.

/**
 * @param {Float32Array|Uint8Array} a captura anterior en gris (w*h)
 * @param {Float32Array|Uint8Array} b captura nueva en gris (w*h)
 * @returns {{dy:number, moved:boolean, confidence:number, changedRows:number}}
 */
export function estimateShift(a, b, w, h, { minOverlap = 0.15, threshold = 2.2, range = null } = {}) {
  const rowDiff = (ra, rb) => {
    let s = 0;
    const ia = ra * w, ib = rb * w;
    for (let x = 0; x < w; x++) s += Math.abs(a[ia + x] - b[ib + x]);
    return s / w;
  };
  const rowVar = (arr, r) => {
    let s = 0, s2 = 0;
    const i0 = r * w;
    for (let x = 0; x < w; x++) {
      const v = arr[i0 + x];
      s += v;
      s2 += v * v;
    }
    const m = s / w;
    return s2 / w - m * m;
  };
  // Filas que cambiaron (sin desplazamiento): ahí está el contenido que se movió.
  const changed = [];
  let base = 0;
  for (let y = 0; y < h; y++) {
    const d = rowDiff(y, y);
    if (d > threshold) {
      changed.push(y);
      base += d;
    }
  }
  if (changed.length < Math.max(3, h * 0.04)) return { dy: 0, moved: false, confidence: 1, changedRows: changed.length };
  base /= changed.length;
  // Solo filas con algo de textura (las lisas encajan en cualquier lado).
  const rows = changed.filter((y) => rowVar(b, y) > 6);
  const useRows = rows.length >= 6 ? rows : changed;
  let best = 0, bestScore = Infinity;
  const minRows = Math.max(4, useRows.length * minOverlap);
  const lo = range ? Math.max(1, range[0]) : 1;
  const hi = range ? Math.min(h - 1, range[1]) : h - 1;
  for (let dy = lo; dy <= hi; dy++) {
    let sum = 0, n = 0;
    for (const y of useRows) {
      const ya = y + dy;
      if (ya >= h) break;
      sum += rowDiff(ya, y);
      n++;
    }
    if (n < minRows) break;
    const score = sum / n;
    if (score < bestScore) {
      bestScore = score;
      best = dy;
    }
  }
  if (!best) return { dy: 0, moved: false, confidence: 0, changedRows: changed.length };
  const confidence = Math.max(0, Math.min(1, 1 - bestScore / Math.max(1e-6, base)));
  return { dy: best, moved: confidence > 0.2, confidence, changedRows: changed.length };
}

/** Afina un desplazamiento aproximado buscando ±radius filas a mayor resolución. */
export function refineShift(a, b, w, h, approx, radius = 4) {
  const r = estimateShift(a, b, w, h, { range: [approx - radius, approx + radius], minOverlap: 0.05 });
  return r.dy || approx;
}
