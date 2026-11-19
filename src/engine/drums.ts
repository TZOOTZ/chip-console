// ── Síntesis de percusión para el DAC (PCM de 8 bits, estilo Mega Drive) ─────
//
// Todo en TypeScript puro y determinista (ruido con PRNG fijo) para que la
// previsualización y el VGM exportado suenen idénticos.
import type { DrumVoice } from '../music/song'

class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed | 0 || 1
  }
  /** -1..1 */
  next(): number {
    let s = this.s
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.s = s
    return ((s >>> 0) / 4294967296) * 2 - 1
  }
}

class Biquad {
  private b0 = 0
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  static make(type: 'hp' | 'bp' | 'lp', fc: number, sr: number, q = 0.707): Biquad {
    const f = new Biquad()
    const w0 = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr
    const cos = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * q)
    let b0: number, b1: number, b2: number
    if (type === 'hp') {
      b0 = (1 + cos) / 2
      b1 = -(1 + cos)
      b2 = b0
    } else if (type === 'lp') {
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = b0
    } else {
      b0 = alpha
      b1 = 0
      b2 = -alpha
    }
    const a0 = 1 + alpha
    f.b0 = b0 / a0
    f.b1 = b1 / a0
    f.b2 = b2 / a0
    f.a1 = (-2 * cos) / a0
    f.a2 = (1 - alpha) / a0
    return f
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** el timbal con pitch = 0 suena en Do2; cada 1/24 de pitch es un semitono (pitch = 1 → Do4): ver timpPitch en song.ts */
const TIMP_BASE_HZ = 65.406

/** frecuencias metálicas de los hats clásicos (TR-606/808) */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800]

function sq(phase: number): number {
  return phase - Math.floor(phase) < 0.5 ? 1 : -1
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** base64 → bytes (el worklet no tiene atob) */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64.indexOf(clean[i])
    bits += 6
    if (bits >= 8) {
      bits -= 8
      if (o < out.length) out[o++] = (acc >> bits) & 0xff
    }
  }
  return out
}

/** bytes → base64 */
export function toBase64(u8: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u8.length; i += 3) {
    const n = (u8[i] << 16) | ((u8[i + 1] ?? 0) << 8) | (u8[i + 2] ?? 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=')
  }
  return s
}

/**
 * Una muestra real: PCM de 8 bits sin signo grabado a `v.rate`, remuestreado al vuelo (interpolación
 * lineal) a la frecuencia de reproducción. Se normaliza al nivel del sonido, como los sintéticos.
 */
function renderSample(v: DrumVoice, sr: number): Float32Array {
  const src = fromBase64(v.pcm ?? '')
  const rate = v.rate ?? 11025
  const n = Math.max(32, Math.round((src.length / rate) * sr))
  const out = new Float32Array(n)
  let pk = 0
  for (let i = 0; i < n; i++) {
    const x = (i * rate) / sr
    const k = Math.min(src.length - 1, Math.floor(x))
    const a = src[k] ?? 128
    const b = src[Math.min(src.length - 1, k + 1)] ?? 128
    const s = ((a + (b - a) * (x - k)) - 128) / 128
    out[i] = s
    pk = Math.max(pk, Math.abs(s))
  }
  const g = pk > 0 ? v.gain / pk : 0
  for (let i = 0; i < n; i++) out[i] *= g
  return out
}

/** Renderiza un golpe de batería a PCM mono Float32 (-1..1). */
export function renderDrum(v: DrumVoice, sr: number): Float32Array {
  if (v.kind === 'sample' && v.pcm) return renderSample(v, sr)
  const rng = new Rng(0x9e3779b1 ^ (v.kind.charCodeAt(0) << 8) ^ Math.round(v.pitch * 100))
  let dur: number
  switch (v.kind) {
    case 'kick':
      dur = lerp(0.14, 0.5, v.decay)
      break
    case 'snare':
      dur = lerp(0.12, 0.36, v.decay)
      break
    case 'hat':
      dur = lerp(0.04, 0.14, v.decay)
      break
    case 'ohat':
      dur = lerp(0.18, 0.6, v.decay)
      break
    case 'clap':
      dur = lerp(0.12, 0.34, v.decay)
      break
    case 'tom':
      dur = lerp(0.14, 0.5, v.decay)
      break
    case 'rim':
      dur = 0.05
      break
    case 'zap':
      dur = lerp(0.1, 0.55, v.decay)
      break
    case 'timp':
      dur = lerp(0.22, 0.75, v.decay)
      break
    case 'crash':
      dur = lerp(0.35, 1.1, v.decay)
      break
    case 'bolt':
      dur = lerp(0.25, 0.9, v.decay)
      break
    case 'thunder':
      dur = lerp(1.2, 4.5, v.decay)
      break
    case 'arc':
      dur = lerp(0.15, 0.9, v.decay)
      break
    default:
      dur = lerp(0.08, 0.3, v.decay)
      break
  }
  const n = Math.max(32, Math.round(dur * sr))
  const out = new Float32Array(n)
  const dt = 1 / sr

  switch (v.kind) {
    case 'kick': {
      const fEnd = lerp(38, 95, v.pitch)
      const fStart = fEnd * lerp(2.5, 6, v.tone)
      const tauP = lerp(0.014, 0.03, v.decay)
      const tauA = dur / 4.5
      let ph = 0
      for (let i = 0; i < n; i++) {
        const t = i * dt
        const f = fEnd + (fStart - fEnd) * Math.exp(-t / tauP)
        ph += f * dt
        let s = Math.sin(2 * Math.PI * ph) * Math.exp(-t / tauA)
        // golpe seco inicial
        if (t < 0.0025) s += rng.next() * 0.3 * (1 - t / 0.0025) * v.tone
        out[i] = s
      }
      break
    }
    case 'snare': {
      const hp = Biquad.make('hp', 900, sr)
      const lp = Biquad.make('lp', 4600, sr)
      const bp = Biquad.make('bp', 2600, sr, 0.6)
      const tauN = dur / 4
      const tauT = lerp(0.03, 0.07, v.decay)
      const f1 = lerp(150, 230, v.pitch)
      const f2 = f1 * 1.87
      let p1 = 0
      let p2 = 0
      for (let i = 0; i < n; i++) {
        const t = i * dt
        const noise = lp.run(hp.run(rng.next())) + 0.8 * bp.run(rng.next())
        p1 += f1 * dt
        p2 += f2 * dt
        const tone = (Math.sin(2 * Math.PI * p1) + 0.5 * Math.sin(2 * Math.PI * p2)) * Math.exp(-t / tauT)
        out[i] = noise * Math.exp(-t / tauN) * lerp(0.4, 1, v.tone) + tone * lerp(0.3, 0.9, 1 - v.tone) * 0.9
      }
      break
    }
    case 'hat':
    case 'ohat': {
      const hp = Biquad.make('hp', lerp(3800, 6200, v.tone), sr, 0.9)
      const tau = dur / (v.kind === 'hat' ? 3.2 : 4)
      const scale = lerp(0.8, 1.5, v.pitch)
      const ph = METAL.map(() => 0)
      for (let i = 0; i < n; i++) {
        const t = i * dt
        let m = 0
        for (let k = 0; k < METAL.length; k++) {
          ph[k] += METAL[k] * scale * 8 * dt
          m += sq(ph[k])
        }
        const x = hp.run(m / 6 * 0.7 + rng.next() * 0.5)
        out[i] = x * Math.exp(-t / tau)
      }
      break
    }
    case 'clap': {
      const bp = Biquad.make('bp', lerp(1000, 1800, v.pitch), sr, 1.1)
      const tail = dur / 4
      for (let i = 0; i < n; i++) {
        const t = i * dt
        let env = 0
        // tres golpes cortos y una cola
        for (const d of [0, 0.011, 0.022]) {
          const tt = t - d
          if (tt >= 0 && tt < 0.009) env += 1 - tt / 0.009
        }
        if (t >= 0.022) env += 0.9 * Math.exp(-(t - 0.022) / tail)
        out[i] = bp.run(rng.next()) * env
      }
      break
    }
    case 'tom': {
      const fEnd = lerp(75, 260, v.pitch)
      const fStart = fEnd * lerp(1.3, 2.2, v.tone)
      const tauP = 0.035
      const tauA = dur / 4
      let ph = 0
      for (let i = 0; i < n; i++) {
        const t = i * dt
        const f = fEnd + (fStart - fEnd) * Math.exp(-t / tauP)
        ph += f * dt
        out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t / tauA)
      }
      break
    }
    case 'zap': {
      // syndrum / láser de la música disco espacial: un seno cuyo tono cae en picado.
      // pitch = altura de arranque · tone = cuánto cae · decay = duración
      const fStart = lerp(420, 2400, v.pitch)
      const fEnd = fStart * lerp(0.5, 0.07, v.tone)
      const tauP = dur * lerp(0.4, 0.22, v.tone)
      const tauA = dur / 3.4
      let ph = 0
      for (let i = 0; i < n; i++) {
        const t = i * dt
        const f = fEnd + (fStart - fEnd) * Math.exp(-t / tauP)
        ph += f * dt
        // un poco de segundo armónico para que muerda por encima de la mezcla
        out[i] = (Math.sin(2 * Math.PI * ph) + 0.22 * Math.sin(4 * Math.PI * ph)) * Math.exp(-t / tauA)
      }
      break
    }
    case 'timp': {
      // timbal de orquesta. pitch recorre dos octavas exactas (Do2–Do4) para poder afinarlo a la
      // tonalidad del tema · tone = dureza de la baqueta (parciales y golpe) · decay = resonancia.
      // Los parciales del parche (1 · 1,5 · 2 · 2,44) se apagan antes que la fundamental.
      const f0 = TIMP_BASE_HZ * Math.pow(2, 2 * v.pitch)
      const tauA = dur / 3.2
      const lp = Biquad.make('lp', lerp(600, 2600, v.tone), sr)
      // [relación con la fundamental, nivel, vida respecto a la fundamental]: son los que se oyen en altavoces pequeños
      const partials: [number, number, number][] = [
        [1.5, lerp(0.35, 0.8, v.tone), 0.6],
        [1.99, lerp(0.2, 0.55, v.tone), 0.45],
        [2.44, lerp(0.1, 0.4, v.tone), 0.33],
        [2.9, lerp(0.03, 0.22, v.tone), 0.24],
      ]
      let ph = 0
      for (let i = 0; i < n; i++) {
        const t = i * dt
        // el parche se destensa tras el golpe: arranca un poco alto
        ph += f0 * (1 + 0.07 * Math.exp(-t / 0.03)) * dt
        const w = 2 * Math.PI * ph
        let s = Math.sin(w) * Math.exp(-t / tauA)
        for (const [ratio, amp, life] of partials) s += amp * Math.sin(ratio * w) * Math.exp(-t / (tauA * life))
        if (t < 0.014) s += lp.run(rng.next()) * 1.2 * (1 - t / 0.014)
        out[i] = s
      }
      break
    }
    case 'crash': {
      // plato: las cuadradas inarmónicas de los charles, más graves, con mucho ruido y cola larga
      const hp = Biquad.make('hp', lerp(1600, 3600, v.tone), sr, 0.8)
      const tau = dur / 3.2
      const scale = lerp(0.8, 1.4, v.pitch)
      const ph = METAL.map(() => 0)
      for (let i = 0; i < n; i++) {
        const t = i * dt
        let m = 0
        for (let k = 0; k < METAL.length; k++) {
          ph[k] += METAL[k] * scale * 5.3 * dt
          m += sq(ph[k])
        }
        const x = hp.run((m / 6) * 0.5 + rng.next() * 0.75)
        out[i] = x * (0.4 * Math.exp(-t / 0.03) + Math.exp(-t / tau))
      }
      break
    }
    case 'rim': {
      const f = lerp(1500, 2100, v.pitch)
      for (let i = 0; i < n; i++) {
        const t = i * dt
        const env = Math.exp(-t / 0.006)
        out[i] =
          (Math.sin(2 * Math.PI * f * t) * 0.8 + Math.sin(2 * Math.PI * f * 0.31 * t) * 0.6 + rng.next() * 0.25) * env
      }
      break
    }
    case 'bolt': {
      // rayo: el chasquido de la descarga (6 ms de ruido de banda ancha a tope) y el chisporroteo que
      // lo sigue, golpecitos de ruido cada vez más espaciados y flojos sobre un siseo que se apaga.
      // pitch = densidad del chisporroteo · tone = brillo (corte del paso-alto) · decay = duración
      const hp = Biquad.make('hp', lerp(500, 2600, v.tone), sr, 0.7)
      const rate0 = lerp(40, 260, v.pitch)
      const u = (): number => (rng.next() + 1) / 2
      let next = 0.006
      let burst = 0
      let amp = 0
      for (let i = 0; i < n; i++) {
        const t = i * dt
        let s = t < 0.006 ? rng.next() * (1.6 - (0.6 * t) / 0.006) : 0
        if (t >= next) {
          burst = Math.round(sr * lerp(0.0008, 0.0025, u()))
          amp = Math.exp(-t / (dur / 3)) * (0.5 + 0.5 * u())
          // llegadas de Poisson cuya frecuencia cae con el tiempo: cada vez más espaciadas
          next = t + -Math.log(1e-6 + u()) / (rate0 * Math.exp(-t / (dur / 2.5)))
        }
        if (burst > 0) {
          s += rng.next() * amp
          burst--
        }
        s += rng.next() * 0.35 * Math.exp(-t / (dur / 5))
        out[i] = hp.run(s)
      }
      break
    }
    case 'thunder': {
      // trueno: el estallido (si cae cerca), el primer golpe con cuerpo y luego el retumbo, que llega en
      // oleadas, rueda, se oscurece según se aleja y se apaga en una cola larga.
      // pitch = altura del retumbo · tone = cercanía: estallido, ataque rápido y brillo del golpe · decay = duración
      const fc = lerp(60, 240, v.pitch)
      // dos caminos de ruido grave: el del golpe (con cuerpo) y el del retumbo (hondo); se pasa de uno a otro
      const lpA = Biquad.make('lp', fc * 1.7, sr, 0.6)
      const lpA2 = Biquad.make('lp', fc * 2.2, sr, 0.6)
      const lpB = Biquad.make('lp', fc * 0.6, sr, 0.7)
      const lpB2 = Biquad.make('lp', fc * 0.8, sr, 0.7)
      // sin subsónico: lo que no se oye solo come margen
      const hp = Biquad.make('hp', 34, sr, 0.7)
      const hp2 = Biquad.make('hp', 34, sr, 0.7)
      const crackHp = Biquad.make('hp', 1200, sr)
      // el rodar: una modulación lenta y desigual (ruido a 3 Hz)
      const wob = Biquad.make('lp', 3, sr, 0.7)
      const u = (): number => (rng.next() + 1) / 2
      const att = lerp(0.2, 0.02, v.tone)
      // la cola: cae unos 30 dB a lo largo del trueno
      const tau = dur / 3
      // cada oleada se apaga despacio
      const tauW = dur / 2.5
      // el paso del golpe al retumbo
      const tDark = lerp(0.6, 1.1, v.tone)
      const waves: [number, number][] = [[0, 1]]
      for (let k = 1; k <= 4; k++) waves.push([dur * (0.06 + 0.13 * k) * (0.8 + 0.4 * u()), 0.45 + 0.35 * u()])
      for (let i = 0; i < n; i++) {
        const t = i * dt
        let env = 0
        for (const [t0, g] of waves) {
          if (t < t0) continue
          const x = t - t0
          env += g * (1 - Math.exp(-x / att)) * Math.exp(-x / tauW)
        }
        env *= Math.exp(-t / tau)
        const roll = 1 + 2.8 * wob.run(rng.next())
        const r = rng.next()
        const w = Math.exp(-t / tDark)
        const body = lpA2.run(lpA.run(r))
        const deep = lpB2.run(lpB.run(r)) * 1.4
        let s = hp2.run(hp.run(body * w + deep * (1 - w))) * 7 * env * Math.max(0.2, roll)
        if (t < 0.06) s += crackHp.run(rng.next()) * v.tone * 1.4 * Math.exp(-t / 0.012)
        out[i] = s
      }
      break
    }
    case 'arc': {
      // chispazo: el arco de un pararrayos cargado. Un tren de impulsos a frecuencia de zumbido que
      // titubea y se salta descargas, con su resonancia aguda y chispas sueltas por encima.
      // pitch = frecuencia del zumbido · tone = chispas frente a zumbido · decay = duración
      const f = lerp(50, 220, v.pitch)
      const hp = Biquad.make('hp', 90, sr, 0.7)
      const bp = Biquad.make('bp', lerp(900, 2400, v.pitch), sr, 1.4)
      const crackHp = Biquad.make('hp', 2000, sr)
      const flick = Biquad.make('lp', 9, sr, 0.7)
      const u = (): number => (rng.next() + 1) / 2
      const kPulse = Math.exp(-dt / 0.001)
      let ph = 0
      let pulse = 0
      let next = 0.01
      let burst = 0
      for (let i = 0; i < n; i++) {
        const t = i * dt
        ph += f * (1 + 0.08 * rng.next()) * dt
        if (ph >= 1) {
          ph -= 1
          // una de cada siete descargas no salta
          if (u() > 0.15) pulse = 0.6 + 0.4 * u()
        }
        const buzz = hp.run(pulse) * 0.8 + bp.run(pulse) * 2.2
        pulse *= kPulse
        let crack = 0
        if (t >= next) {
          burst = Math.round(sr * lerp(0.0006, 0.002, u()))
          next = t + -Math.log(1e-6 + u()) / lerp(8, 45, v.tone)
        }
        if (burst > 0) {
          crack = crackHp.run(rng.next()) * 1.2
          burst--
        } else crackHp.run(0)
        // titubeo del arco, ataque de 5 ms y el último tercio que se apaga
        const env = Math.min(1, t / 0.005) * Math.min(1, (dur - t) / (dur * 0.35)) * (0.75 + 0.6 * flick.run(rng.next()))
        out[i] = (buzz * lerp(1, 0.55, v.tone) + crack * lerp(0.4, 1, v.tone)) * env
      }
      break
    }
    default: {
      // cowbell: dos cuadradas desafinadas con paso de banda
      const bp = Biquad.make('bp', lerp(700, 1000, v.pitch), sr, 2)
      const f1 = lerp(480, 620, v.pitch)
      const f2 = f1 * 1.48
      const tau = dur / 3.5
      let p1 = 0
      let p2 = 0
      for (let i = 0; i < n; i++) {
        const t = i * dt
        p1 += f1 * dt
        p2 += f2 * dt
        out[i] = bp.run(sq(p1) + sq(p2)) * Math.exp(-t / tau)
      }
      break
    }
  }

  // normaliza el pico al nivel del instrumento y cierra con un fundido corto
  let pk = 0
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]))
  const g = pk > 0 ? v.gain / pk : 0
  const fade = Math.min(64, n >> 2)
  for (let i = 0; i < n; i++) {
    let s = out[i] * g
    if (i >= n - fade) s *= (n - 1 - i) / fade
    out[i] = s
  }
  return out
}

/** Cuantiza a 8 bits sin signo como lo haría el DAC (0x80 = silencio). */
export function toU8(pcm: Float32Array): Uint8Array {
  const out = new Uint8Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    out[i] = Math.max(1, Math.min(255, Math.round(s * 127) + 128))
  }
  return out
}
