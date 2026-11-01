// ── Tonalidad de un tema a partir de sus notas ──────────────────────────────────────
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** perfiles de Krumhansl: la tónica y si es mayor o menor, a partir de cuánto suena cada clase de altura */
export function detectKey(weights: number[]): { key: number; minor: boolean } {
  const corr = (profile: number[], rot: number): number => {
    const x = weights
    const mx = x.reduce((a, c) => a + c, 0) / 12
    const my = profile.reduce((a, c) => a + c, 0) / 12
    let sxy = 0
    let sxx = 0
    let syy = 0
    for (let i = 0; i < 12; i++) {
      const a = x[(i + rot) % 12] - mx
      const c = profile[i] - my
      sxy += a * c
      sxx += a * a
      syy += c * c
    }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0
  }
  let best = { key: 0, minor: false, r: -2 }
  for (let k = 0; k < 12; k++) {
    for (const minor of [false, true]) {
      const r = corr(minor ? MINOR : MAJOR, k)
      if (r > best.r) best = { key: k, minor, r }
    }
  }
  return { key: best.key, minor: best.minor }
}

