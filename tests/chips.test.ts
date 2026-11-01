import { describe, expect, it } from 'vitest'
import { ChipConsole } from '../src/core/mixer'
import { midiToHz, psgHzFromPeriod, psgPeriodFromHz, ymFreqFromHz, ymHzFromFreq } from '../src/core/chipmath'
import { YM2612 } from '../src/core/ym2612'
import { db, peak, peakFreq, rms } from './helpers'

// registro de operador por índice lógico (op1..op4 → offsets +0, +8, +4, +12)
const OP_OFFSET = [0, 8, 4, 12]

interface OpParams {
  mul?: number
  dt?: number
  tl?: number
  rs?: number
  ar?: number
  am?: number
  d1r?: number
  sl?: number
  d2r?: number
  rr?: number
}

function setOp(ym: YM2612, ch: number, op: number, p: OpParams) {
  const port = ch < 3 ? 0 : 1
  const c = ch % 3
  const o = OP_OFFSET[op] + c
  ym.write(port, 0x30 + o, ((p.dt ?? 0) << 4) | (p.mul ?? 1))
  ym.write(port, 0x40 + o, p.tl ?? 127)
  ym.write(port, 0x50 + o, ((p.rs ?? 0) << 6) | (p.ar ?? 31))
  ym.write(port, 0x60 + o, ((p.am ?? 0) << 7) | (p.d1r ?? 0))
  ym.write(port, 0x70 + o, p.d2r ?? 0)
  ym.write(port, 0x80 + o, ((p.sl ?? 0) << 4) | (p.rr ?? 15))
}

function setChannel(ym: YM2612, ch: number, alg: number, fb = 0, pan = 3) {
  const port = ch < 3 ? 0 : 1
  const c = ch % 3
  ym.write(port, 0xb0 + c, (fb << 3) | alg)
  ym.write(port, 0xb4 + c, pan << 6)
}

function setFreq(ym: YM2612, ch: number, hz: number) {
  const { fnum, block } = ymFreqFromHz(hz)
  const port = ch < 3 ? 0 : 1
  const c = ch % 3
  ym.write(port, 0xa4 + c, (block << 3) | (fnum >> 8))
  ym.write(port, 0xa0 + c, fnum & 0xff)
}

function keySel(ch: number) {
  return ch < 3 ? ch : ch + 1
}
const keyOn = (ym: YM2612, ch: number) => ym.write(0, 0x28, 0xf0 | keySel(ch))
const keyOff = (ym: YM2612, ch: number) => ym.write(0, 0x28, keySel(ch))

function run(ym: YM2612, n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    ym.tick()
    out[i] = (ym.outL + ym.outR) * 0.5
  }
  return out
}

describe('YM2612 · frecuencias', () => {
  it('fnum/block reproduce la nota con error < 1 cent', () => {
    for (let m = 24; m <= 108; m++) {
      const hz = midiToHz(m)
      const { fnum, block } = ymFreqFromHz(hz)
      expect(fnum).toBeGreaterThan(0)
      expect(fnum).toBeLessThanOrEqual(2047)
      const real = ymHzFromFreq(fnum, block)
      const cents = 1200 * Math.log2(real / hz)
      // con fnum >= 1024 el error es < 1 cent; las notas muy graves tienen menos resolución
      expect(Math.abs(cents)).toBeLessThan(m < 30 ? 3 : 1.2)
    }
  })

  it('C4 = bloque 3 / fnum 1288 (≡ bloque 4 / fnum 644 de las tablas clásicas)', () => {
    const { fnum, block } = ymFreqFromHz(midiToHz(60))
    expect(fnum * (1 << block)).toBeCloseTo(644 * 16, -1)
  })

  it('un operador solo produce un seno a la frecuencia del registro', () => {
    for (const midi of [36, 48, 57, 60, 69, 72, 84, 96]) {
      const ym = new YM2612()
      setChannel(ym, 0, 7)
      setOp(ym, 0, 3, { tl: 0, mul: 1 })
      for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
      setFreq(ym, 0, midiToHz(midi))
      keyOn(ym, 0)
      const x = run(ym, 24000)
      const f = peakFreq(x.subarray(2000), ym.rate)
      const target = midiToHz(midi)
      expect(Math.abs(1200 * Math.log2(f / target))).toBeLessThan(2)
    }
  })

  it('el multiplicador MUL escala la frecuencia del operador', () => {
    for (const mul of [0, 1, 2, 3, 5]) {
      const ym = new YM2612()
      setChannel(ym, 0, 7)
      setOp(ym, 0, 3, { tl: 0, mul })
      for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
      setFreq(ym, 0, 220)
      keyOn(ym, 0)
      const f = peakFreq(run(ym, 24000).subarray(2000), ym.rate)
      const expected = 220 * (mul === 0 ? 0.5 : mul)
      expect(f / expected).toBeGreaterThan(0.995)
      expect(f / expected).toBeLessThan(1.005)
    }
  })
})

describe('YM2612 · operadores y algoritmos', () => {
  // frecuencia propia de cada operador lógico para identificarlo en el espectro
  const MULS = [1, 2, 3, 4]

  it('el orden de registros S1-S3-S2-S4 se mapea bien a op1-op2-op3-op4', () => {
    for (let op = 0; op < 4; op++) {
      const ym = new YM2612()
      setChannel(ym, 0, 7)
      for (let o = 0; o < 4; o++) setOp(ym, 0, o, { tl: o === op ? 0 : 127, mul: MULS[o] })
      setFreq(ym, 0, 200)
      keyOn(ym, 0)
      const f = peakFreq(run(ym, 24000).subarray(2000), ym.rate)
      expect(f / (200 * MULS[op])).toBeGreaterThan(0.99)
      expect(f / (200 * MULS[op])).toBeLessThan(1.01)
    }
  })

  const CARRIERS: Record<number, number[]> = {
    0: [3],
    1: [3],
    2: [3],
    3: [3],
    4: [1, 3],
    5: [1, 2, 3],
    6: [1, 2, 3],
    7: [0, 1, 2, 3],
  }

  it('cada algoritmo deja audibles solo sus portadores', () => {
    for (let alg = 0; alg < 8; alg++) {
      for (let op = 0; op < 4; op++) {
        const ym = new YM2612()
        setChannel(ym, 0, alg)
        for (let o = 0; o < 4; o++) setOp(ym, 0, o, { tl: o === op ? 0 : 127 })
        setFreq(ym, 0, 220)
        keyOn(ym, 0)
        const x = run(ym, 12000)
        const level = peak(x, 4000)
        const isCarrier = CARRIERS[alg].includes(op)
        if (isCarrier) expect(level, `alg ${alg} op${op + 1} portador`).toBeGreaterThan(0.05)
        else expect(level, `alg ${alg} op${op + 1} modulador`).toBeLessThan(0.002)
      }
    }
  })

  it('la modulación enriquece el espectro (alg 4: op1 → op2)', () => {
    const measure = (modTl: number) => {
      const ym = new YM2612()
      setChannel(ym, 0, 4)
      setOp(ym, 0, 0, { tl: modTl, mul: 1 })
      setOp(ym, 0, 1, { tl: 0, mul: 1 })
      setOp(ym, 0, 2, { tl: 127 })
      setOp(ym, 0, 3, { tl: 127 })
      setFreq(ym, 0, 220)
      keyOn(ym, 0)
      return run(ym, 24000).subarray(2000)
    }
    const clean = measure(127)
    const fm = measure(20)
    // sin modulación casi todo es fundamental; con modulación hay más armónicos
    const energy = (x: Float32Array, hz: number) => {
      // energía fuera de la fundamental ≈ RMS total - RMS del componente fundamental
      const n = x.length
      let c = 0
      let s = 0
      const w = (2 * Math.PI * hz) / 53267.04
      for (let i = 0; i < n; i++) {
        c += x[i] * Math.cos(w * i)
        s += x[i] * Math.sin(w * i)
      }
      const fund = (Math.hypot(c, s) * 2) / n / Math.SQRT2
      return Math.sqrt(Math.max(0, rms(x) ** 2 - fund ** 2))
    }
    expect(energy(fm, 220)).toBeGreaterThan(energy(clean, 220) * 5)
  })
})

describe('YM2612 · nivel y envolvente', () => {
  it('TL: cada 8 pasos = -6 dB', () => {
    const level = (tl: number) => {
      const ym = new YM2612()
      setChannel(ym, 0, 7)
      setOp(ym, 0, 3, { tl })
      for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
      setFreq(ym, 0, 220)
      keyOn(ym, 0)
      return peak(run(ym, 12000), 4000)
    }
    const a = level(0)
    const b = level(8)
    const c = level(16)
    expect(db(b / a)).toBeGreaterThan(-6.6)
    expect(db(b / a)).toBeLessThan(-5.4)
    expect(db(c / b)).toBeGreaterThan(-6.6)
    expect(db(c / b)).toBeLessThan(-5.4)
  })

  it('el nivel máximo de un operador ronda ±0.25 de fondo de escala (8168/32768)', () => {
    const ym = new YM2612()
    setChannel(ym, 0, 7, 0, 3)
    setOp(ym, 0, 3, { tl: 0 })
    for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
    setFreq(ym, 0, 220)
    keyOn(ym, 0)
    const x = run(ym, 12000)
    // L y R suman: media (L+R)/2 = 8168/32768 · 2 / 2
    expect(peak(x, 4000)).toBeGreaterThan(0.24)
    expect(peak(x, 4000)).toBeLessThan(0.26)
  })

  function decayTime(d1r: number): number {
    // tiempo (en muestras) en que el pico cae 6 dB respecto al inicial
    const ym = new YM2612()
    setChannel(ym, 0, 7)
    setOp(ym, 0, 3, { tl: 0, ar: 31, d1r, sl: 15 })
    for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
    setFreq(ym, 0, 440)
    keyOn(ym, 0)
    const total = Math.round(ym.rate * 12)
    const x = run(ym, total)
    const win = 200
    const ref = peak(x, 1000, 1000 + win)
    for (let i = 1000; i + win < total; i += 50) {
      if (peak(x, i, i + win) < ref / 2) return i / ym.rate
    }
    return Infinity
  }

  it('D1R: +2 pasos (rate = 2·D1R → +4) divide el tiempo por ~2', () => {
    const t6 = decayTime(6)
    const t8 = decayTime(8)
    const t10 = decayTime(10)
    expect(Number.isFinite(t6)).toBe(true)
    expect(t6).toBeGreaterThan(1.0)
    expect(t6 / t8).toBeGreaterThan(1.8)
    expect(t6 / t8).toBeLessThan(2.2)
    expect(t8 / t10).toBeGreaterThan(1.8)
    expect(t8 / t10).toBeLessThan(2.2)
  })

  it('el ataque rápido es instantáneo y el lento tarda', () => {
    const attack = (ar: number) => {
      const ym = new YM2612()
      setChannel(ym, 0, 7)
      setOp(ym, 0, 3, { tl: 0, ar, d1r: 0, sl: 0 })
      for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
      setFreq(ym, 0, 440)
      keyOn(ym, 0)
      const x = run(ym, 20000)
      const final = peak(x, 18000)
      for (let i = 0; i < 18000; i += 20) if (peak(x, i, i + 120) > final * 0.5) return i / ym.rate
      return Infinity
    }
    expect(attack(31)).toBeLessThan(0.003)
    expect(attack(20)).toBeLessThan(attack(12))
    expect(attack(12)).toBeLessThan(0.4)
  })

  it('key-off libera con la velocidad de RR', () => {
    const releaseTime = (rr: number) => {
      const ym = new YM2612()
      setChannel(ym, 0, 7)
      setOp(ym, 0, 3, { tl: 0, ar: 31, d1r: 0, sl: 0, rr })
      for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
      setFreq(ym, 0, 440)
      keyOn(ym, 0)
      run(ym, 5000)
      keyOff(ym, 0)
      const x = run(ym, Math.round(ym.rate * 8))
      for (let i = 0; i < x.length - 200; i += 50) if (peak(x, i, i + 200) < 0.005) return i / ym.rate
      return Infinity
    }
    const fast = releaseTime(15)
    const slow = releaseTime(6)
    expect(fast).toBeLessThan(slow)
    expect(fast).toBeLessThan(0.5)
    expect(Number.isFinite(slow)).toBe(true)
  })

  it('el nivel de sustain SL deja el operador a -3 dB·SL', () => {
    const sustained = (sl: number) => {
      const ym = new YM2612()
      setChannel(ym, 0, 7)
      setOp(ym, 0, 3, { tl: 0, ar: 31, d1r: 31, sl, d2r: 0 })
      for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
      setFreq(ym, 0, 440)
      keyOn(ym, 0)
      const x = run(ym, 40000)
      return peak(x, 30000, 38000)
    }
    const l0 = sustained(0)
    const l4 = sustained(4)
    expect(db(l4 / l0)).toBeGreaterThan(-12.8) // -12 dB ± ruido de cuantización
    expect(db(l4 / l0)).toBeLessThan(-11.2)
  })
})

describe('YM2612 · DAC, pan y LFO', () => {
  it('el DAC sustituye al canal 6', () => {
    const ym = new YM2612()
    ym.write(0, 0x2b, 0x80)
    ym.write(0, 0x2a, 0xff)
    const x = run(ym, 100)
    expect(x[50]).toBeCloseTo(((0xff - 0x80) << 6) / 32768, 4)
    ym.write(0, 0x2a, 0x00)
    const y = run(ym, 10)
    expect(y[5]).toBeCloseTo(-8192 / 32768, 4)
  })

  it('pan izquierdo/derecho', () => {
    const make = (pan: number) => {
      const ym = new YM2612()
      setChannel(ym, 0, 7, 0, pan)
      setOp(ym, 0, 3, { tl: 0 })
      for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
      setFreq(ym, 0, 440)
      keyOn(ym, 0)
      let l = 0
      let r = 0
      for (let i = 0; i < 6000; i++) {
        ym.tick()
        l = Math.max(l, Math.abs(ym.outL))
        r = Math.max(r, Math.abs(ym.outR))
      }
      return { l, r }
    }
    const L = make(2)
    const R = make(1)
    const C = make(3)
    expect(L.l).toBeGreaterThan(0.2)
    expect(L.r).toBe(0)
    expect(R.r).toBeGreaterThan(0.2)
    expect(R.l).toBe(0)
    expect(C.l).toBeGreaterThan(0.2)
    expect(C.r).toBeGreaterThan(0.2)
  })

  it('el LFO hardware (AM) modula el volumen', () => {
    const ym = new YM2612()
    setChannel(ym, 0, 7, 0, 3)
    ym.write(0, 0xb4, 0xc0 | (3 << 4)) // AMS = 3
    setOp(ym, 0, 3, { tl: 0, am: 1 })
    for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
    ym.write(0, 0x22, 0x08 | 0) // LFO lento (3.9 Hz) para medir bien la profundidad
    setFreq(ym, 0, 440)
    keyOn(ym, 0)
    const x = run(ym, 30000)
    const wins: number[] = []
    for (let i = 4000; i + 300 < x.length; i += 300) wins.push(peak(x, i, i + 300))
    const hi = Math.max(...wins)
    const lo = Math.min(...wins)
    expect(db(lo / hi)).toBeLessThan(-8) // AMS 3 = 11.8 dB de profundidad
  })

  it('el LFO hardware (PM) hace vibrato', () => {
    const ym = new YM2612()
    setChannel(ym, 0, 7, 0, 3)
    ym.write(0, 0xb4, 0xc0 | 7) // PMS = 7 (±80 cents)
    setOp(ym, 0, 3, { tl: 0 })
    for (const op of [0, 1, 2]) setOp(ym, 0, op, { tl: 127 })
    ym.write(0, 0x22, 0x08 | 5)
    setFreq(ym, 0, 440)
    keyOn(ym, 0)
    const x = run(ym, 60000)
    // frecuencia instantánea por ventanas: debe variar
    const fs: number[] = []
    for (let i = 4000; i + 4096 < x.length; i += 2048) fs.push(peakFreq(x.subarray(i, i + 4096), ym.rate, 100, 1 << 15))
    const spread = 1200 * Math.log2(Math.max(...fs) / Math.min(...fs))
    expect(spread).toBeGreaterThan(40)
  })
})

describe('SN76489 · PSG', () => {
  it('periodo ↔ frecuencia', () => {
    expect(psgPeriodFromHz(440)).toBe(254)
    expect(psgHzFromPeriod(254)).toBeCloseTo(440.4, 0)
    expect(psgPeriodFromHz(20)).toBe(1023)
  })

  it('tono cuadrado a la frecuencia del registro', () => {
    for (const midi of [57, 60, 69, 81, 93]) {
      const con = new ChipConsole({ sampleRate: 44100 })
      const period = psgPeriodFromHz(midiToHz(midi))
      con.psg.write(0x80 | (period & 15))
      con.psg.write(period >> 4)
      con.psg.write(0x90 | 0) // atenuación 0
      const n = 30000
      const x = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        con.renderSample()
        x[i] = con.l
      }
      const f = peakFreq(x.subarray(3000), 44100)
      expect(f / psgHzFromPeriod(period)).toBeGreaterThan(0.99)
      expect(f / psgHzFromPeriod(period)).toBeLessThan(1.01)
    }
  })

  it('la atenuación es de 2 dB por paso y 15 silencia', () => {
    const level = (att: number) => {
      const con = new ChipConsole({ sampleRate: 44100 })
      con.psg.write(0x80 | 0x0e)
      con.psg.write(0x10)
      con.psg.write(0x90 | att)
      const x = new Float32Array(8000)
      for (let i = 0; i < x.length; i++) {
        con.renderSample()
        x[i] = con.l
      }
      return peak(x, 3000)
    }
    const a0 = level(0)
    const a5 = level(5)
    expect(db(a5 / a0)).toBeGreaterThan(-10.8)
    expect(db(a5 / a0)).toBeLessThan(-9.2)
    expect(level(15)).toBeLessThan(0.001)
  })

  it('ruido: blanco y periódico producen señales distintas y deterministas', () => {
    const gen = (ctl: number) => {
      const con = new ChipConsole({ sampleRate: 44100 })
      con.psg.write(0xe0 | ctl)
      con.psg.write(0xf0 | 0)
      const x = new Float32Array(4000)
      for (let i = 0; i < x.length; i++) {
        con.renderSample()
        x[i] = con.l
      }
      return x
    }
    const white = gen(4)
    const white2 = gen(4)
    const periodic = gen(0)
    expect(rms(white, 500)).toBeGreaterThan(0.02)
    expect(Array.from(white)).toEqual(Array.from(white2))
    expect(Array.from(white)).not.toEqual(Array.from(periodic))
  })
})

describe('Consola · remuestreo', () => {
  it('el mismo tono FM suena a la misma altura a 44.1k y 48k', () => {
    const f = (rate: number) => {
      const con = new ChipConsole({ sampleRate: rate })
      setChannel(con.ym, 0, 7)
      setOp(con.ym, 0, 3, { tl: 0 })
      for (const op of [0, 1, 2]) setOp(con.ym, 0, op, { tl: 127 })
      setFreq(con.ym, 0, 440)
      keyOn(con.ym, 0)
      const n = Math.round(rate * 0.6)
      const x = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        con.renderSample()
        x[i] = con.l
      }
      return peakFreq(x.subarray(2000), rate)
    }
    const a = f(44100)
    const b = f(48000)
    expect(Math.abs(1200 * Math.log2(a / b))).toBeLessThan(2)
    expect(Math.abs(1200 * Math.log2(a / 440))).toBeLessThan(3)
  })
})
