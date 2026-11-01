// ── Medir el tempo de un VGM: la rejilla de semicorcheas que mejor encaja con las notas ──
//
// Un VGM no trae tempo ni compás, solo tiempos. Se busca la duración de paso T que alinea los inicios de nota:
// la coherencia |Σ e^(2πi·t/T)| / N vale 1 cuando todos caen en una rejilla de paso T. Con un tempo fraccionario
// (los drivers cuentan frames: 7 frames por paso son 128,57 BPM) se mide con decimales y las notas se cuantizan con
// el tempo exacto; la canción lleva el entero más cercano. Si hay varias rejillas válidas (T, T/2…), se queda la
// más lenta que no pierda notas. El swing (corcheas a 2/3 de la negra) se detecta aparte.

export interface Grid {
  /** BPM medido, con decimales (la rejilla es de semicorcheas) */
  bpm: number
  /** segundos por paso */
  step: number
  /** instante (s) del paso 0 */
  origin: number
  swung: boolean
  /** coherencia de 0 a 1: cuánto encajan las notas en la rejilla */
  score: number
}

const SWUNG = [0, 1 / 3, 2 / 3, 5 / 6, 1]
const STRAIGHT = [0, 0.25, 0.5, 0.75, 1]

function coherence(times: number[], period: number): { r: number; phase: number } {
  let c = 0
  let s = 0
  const k = (2 * Math.PI) / period
  for (const t of times) {
    c += Math.cos(k * t)
    s += Math.sin(k * t)
  }
  return { r: Math.hypot(c, s) / Math.max(1, times.length), phase: Math.atan2(s, c) }
}

/** busca el BPM de mayor coherencia en [lo, hi]; devuelve todos los máximos locales */
function scan(times: number[], lo: number, hi: number, stepBpm: number): { bpm: number; r: number }[] {
  const pts: { bpm: number; r: number }[] = []
  for (let b = lo; b <= hi + 1e-9; b += stepBpm) pts.push({ bpm: b, r: coherence(times, 15 / b).r })
  return pts.filter((p, i) => p.r >= (pts[i - 1]?.r ?? 0) && p.r >= (pts[i + 1]?.r ?? 0))
}

function fracError(fracs: number[], grid: number[]): number {
  let e = 0
  for (const f of fracs) {
    let m = 1
    for (const g of grid) m = Math.min(m, Math.abs(f - g))
    e += m
  }
  return fracs.length ? e / fracs.length : 0
}

/** entropía (bits) de un histograma */
function entropy(h: number[]): number {
  const n = h.reduce((a, c) => a + c, 0)
  return n ? -h.reduce((e, c) => (c ? e + (c / n) * Math.log2(c / n) : e), 0) : 0
}

export function estimateGrid(times: number[]): Grid {
  const uniq = [...new Set(times.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b)
  if (uniq.length < 8) return { bpm: 120, step: 0.125, origin: uniq[0] ?? 0, swung: false, score: 0 }
  const t0 = uniq[0]
  const upTo = (s: number): number[] => uniq.filter((t) => t - t0 <= s)
  // 1 · las primeras decenas de segundos dan un pico ancho: barrido grueso, y la rejilla más lenta que casi iguale al mejor
  const first = upTo(40)
  const peaks = scan(first, 60, 240, 0.08)
  const best = Math.max(...peaks.map((p) => p.r))
  const slow = peaks.filter((p) => p.r >= 0.97 * best && p.bpm >= 70).sort((a, b) => a.bpm - b.bpm)[0] ?? peaks.sort((a, b) => b.r - a.r)[0]
  // 2 · con más tiempo el pico se afina: dos refinados sucesivos
  const refine = (times2: number[], centre: number, span: number, step: number): number => {
    const r = scan(times2, centre - span, centre + span, step)
    return r.sort((a, b) => b.r - a.r)[0]?.bpm ?? centre
  }
  let bpm = refine(upTo(160), slow.bpm, 0.3, 0.01)
  bpm = refine(uniq, bpm, 0.05, 0.002)
  let step = 15 / bpm
  const { r, phase } = coherence(uniq, step)
  // los puntos de la rejilla están en phi + k·T; el paso 0 es el más cercano al primer inicio
  const phi = (phase / (2 * Math.PI)) * step
  let origin = phi + Math.round((t0 - phi) / step) * step
  // ¿es una rejilla de tresillos (swing)? Las corcheas con swing caen a 2/3 de la negra: la rejilla que las alinea es la de
  // un tercio de negra (tres «pasos» por negra), no la de semicorcheas. Si el histograma de pasos módulo 3 está más
  // estructurado que el módulo 4 (el hueco de 1/3 casi vacío), la rejilla de semicorcheas es la de 4/3 del BPM, con swing
  const idx = uniq.map((t) => Math.round((t - origin) / step))
  const h3 = [0, 0, 0]
  const h4 = [0, 0, 0, 0]
  for (const k of idx) {
    h3[((k % 3) + 3) % 3]++
    h4[((k % 4) + 4) % 4]++
  }
  if (bpm * (4 / 3) <= 240 && entropy(h3) < entropy(h4) - 0.12 && Math.min(...h3) < 0.25 * Math.max(...h3)) {
    const low = h3.indexOf(Math.min(...h3))
    // el paso 0 de la negra es el que va justo después del hueco: el hueco es la posición 1/3
    origin += (((low - 1) % 3) + 3) % 3 * step
    bpm = bpm * (4 / 3)
    step = 15 / bpm
    return { bpm, step, origin, swung: true, score: r }
  }
  // swing: ¿las notas caen mejor en 0, 1/3, 2/3, 5/6 de la negra que en 0, 1/4, 1/2, 3/4?
  const m = uniq.map((t) => (t - origin) / step)
  const straightErr = fracError(m.map((x) => (((x % 4) + 4) % 4) / 4), STRAIGHT)
  let swung = false
  let shift = 0
  if (straightErr > 0.02) {
    let bestErr = Infinity
    for (let o = 0; o < 4; o++) {
      const e = fracError(m.map((x) => ((((x - o) % 4) + 4) % 4) / 4), SWUNG)
      if (e < bestErr) {
        bestErr = e
        shift = o
      }
    }
    swung = bestErr < 0.7 * straightErr
  }
  return { bpm, step, origin: origin + (swung ? shift * step : 0), swung, score: r }
}

/** paso de la rejilla más cercano a un instante (en la rejilla del swing, la de 0, 1/3, 2/3 y 5/6 de la negra) */
export function stepOf(g: Grid, t: number): number {
  if (!g.swung) return Math.round((t - g.origin) / g.step)
  const u = (t - g.origin) / (4 * g.step)
  const beat = Math.floor(u)
  const f = u - beat
  let k = 0
  for (let i = 1; i < SWUNG.length; i++) if (Math.abs(f - SWUNG[i]) < Math.abs(f - SWUNG[k])) k = i
  return beat * 4 + k
}
