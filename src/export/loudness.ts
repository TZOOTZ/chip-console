// ── Sonoridad integrada (LUFS) según ITU-R BS.1770 ──────────────────────────
// Ponderación K (estante agudo de +4 dB y paso-alto de 38 Hz), bloques de 400 ms con solape del 75 %,
// puerta absoluta de −70 LUFS y relativa de −10 LU. Sirve para comparar pistas entre sí: el oído no
// sigue al RMS, y un PSG cuadrado o un metal brillante suenan más fuertes de lo que dice su nivel.

function biquad(x: ArrayLike<number>, b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/**
 * señal con la ponderación K de BS.1770, a cualquier frecuencia de muestreo. Coeficientes por la
 * transformada bilineal con las constantes de la norma (formulación de B. De Man): a 48 kHz dan
 * exactamente los de la tabla de BS.1770 (b0 = 1,53512485958697…); con la fórmula genérica del estante
 * agudo la ganancia a 1 kHz se queda 0,26 dB corta
 */
export function kWeight(x: ArrayLike<number>, sr: number): Float64Array {
  // etapa 1: estante agudo (modelo de la cabeza)
  let K = Math.tan((Math.PI * 1681.974450955533) / sr)
  let Q = 0.7071752369554196
  const Vh = Math.pow(10, 3.999843853973347 / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const shelf = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0)
  // etapa 2: paso-alto RLB
  K = Math.tan((Math.PI * 38.13547087602444) / sr)
  Q = 0.5003270373238773
  a0 = 1 + K / Q + K * K
  return biquad(shelf, 1, -2, 1, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0)
}

/** sonoridad integrada en LUFS de una señal estéreo (−Infinity si es silencio) */
export function integratedLufs(left: ArrayLike<number>, right: ArrayLike<number>, sr: number): number {
  const kl = kWeight(left, sr)
  const kr = kWeight(right, sr)
  const block = Math.round(0.4 * sr)
  const hop = Math.round(0.1 * sr)
  const z: number[] = []
  for (let s = 0; s + block <= kl.length; s += hop) {
    let a = 0
    for (let i = s; i < s + block; i++) a += kl[i] * kl[i] + kr[i] * kr[i]
    z.push(a / block)
  }
  const level = (v: number): number => -0.691 + 10 * Math.log10(v)
  const loud = z.filter((v) => v > 0 && level(v) > -70)
  if (!loud.length) return -Infinity
  const rel = level(loud.reduce((s, v) => s + v, 0) / loud.length) - 10
  const gated = loud.filter((v) => level(v) > rel)
  return level(gated.reduce((s, v) => s + v, 0) / gated.length)
}
