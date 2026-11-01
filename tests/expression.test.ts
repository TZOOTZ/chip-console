// ── Model 1, PSG calibrado y expresión (ligaduras, panorama por nota, velocidad → timbre) ──
import { deflateSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { midiToHz, ymFreqFromHz } from '../src/core/chipmath'
import { MD1_LOWPASS_HZ, PSG_GAIN, type SoundModel } from '../src/core/mixer'
import { Synth } from '../src/engine/synth'
import { packSong, songFromHash, songFromLocationHash, songToHash, unpackSong } from '../src/export/share'
import { captureWrites } from '../src/export/vgm'
import { STYLES, generateSong } from '../src/music/generator'
import { FM, PSG_MAX_CENTS, psgCents, psgInTune } from '../src/music/genkit'
import { FM_PRESETS, createEmptySong } from '../src/music/presets'
import { PSG_RECAL_DB, SONG_VERSION, sanitizeSong, type FmOp, type Note, type Song } from '../src/music/song'
import { peakFreq } from './helpers'

const SR = 44100
/** un paso (semicorchea) a 120 BPM, en muestras */
const STEP = SR / 8
const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12))
const off = (): FmOp => ({ mul: 1, dt: 0, tl: 127, rs: 0, ar: 31, d1r: 0, sl: 0, d2r: 0, rr: 15, am: 0 })

/** canción de un compás con las notas dadas; pistas a tope, sin gate, sin bucle */
function tune(notes: Record<string, Note[]>, mod?: (s: Song) => void): Song {
  const s = createEmptySong()
  s.bpm = 120
  s.patterns[0].bars = 1
  s.loopStart = -1
  for (const t of s.tracks) {
    t.vol = 100
    t.pan = 'C'
    t.gate = 1
  }
  for (const [id, arr] of Object.entries(notes)) s.patterns[0].notes[id] = arr
  mod?.(s)
  return s
}
/** parche de un solo operador senoidal con el nivel pedido */
const sinePatch = (s: Song, tl: number): void => {
  s.fmBank[0] = { name: 'SINE', alg: 7, fb: 0, ops: [{ ...off(), tl }, off(), off(), off()], ams: 0, pms: 0 }
  s.tracks[0].inst = 0
}

function render(song: Song, model: SoundModel, seconds = 2, lowpass = model === 'md1'): { l: Float32Array; r: Float32Array } {
  const synth = new Synth(SR, song, model)
  synth.con.lowpass = lowpass
  synth.stopAtEnd = true
  synth.play(0, 0)
  const n = Math.round(SR * seconds)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  synth.render(l, r, n)
  return { l, r }
}
/** nivel RMS (dB) de un tramo, sin la continua */
function level(x: Float32Array, from: number, to: number): number {
  const a = Math.round(from * SR)
  const b = Math.round(to * SR)
  let mean = 0
  for (let i = a; i < b; i++) mean += x[i]
  mean /= b - a
  let e = 0
  for (let i = a; i < b; i++) e += (x[i] - mean) ** 2
  return db(Math.sqrt(e / (b - a)))
}

/** escrituras de un registro del YM2612 (puerto, registro) → [t, valor] */
function writes(song: Song, port: number, reg: number): [number, number][] {
  const ev = captureWrites(song, 0.3).events
  const out: [number, number][] = []
  for (let i = 0; i < ev.length; i += 4) if (ev[i + 1] === port && ev[i + 2] === reg) out.push([ev[i], ev[i + 3]])
  return out
}
/** bytes escritos al PSG → [t, byte] */
function psgWrites(song: Song): [number, number][] {
  const ev = captureWrites(song, 0.3).events
  const out: [number, number][] = []
  for (let i = 0; i < ev.length; i += 4) if (ev[i + 1] === 2) out.push([ev[i], ev[i + 2]])
  return out
}

// ═════════════════════════════════════════════════════════════════════════════
describe('Model 1: el DAC discreto del YM2612 y el filtro de la placa', () => {
  const long = (note: number, extra: Partial<Note> = {}): Note[] => [{ step: 0, len: 14, note, vel: 15, ...extra }]

  it('un seno por debajo de un LSB sale como una cuadrada de ±4/1024 (el escalón del cruce por cero)', () => {
    // TL 72 = −54 dB: en 9 bits el canal solo vale 0 o −1, y el DAC les suma +4 y −3
    const song = tune({ fm1: long(69) }, (s) => sinePatch(s, 72))
    const md1 = render(song, 'md1', 2, false)
    expect(level(md1.l, 0.3, 1.3)).toBeGreaterThan(db(4 / 1024) - 1)
    expect(level(md1.l, 0.3, 1.3)).toBeLessThan(db(4 / 1024) + 1)
    // sin escalón queda la cuantización a 9 bits a secas: un LSB de pico a pico
    const synth = new Synth(SR, song, 'md1')
    synth.con.lowpass = false
    synth.con.ym.ladder = false
    synth.stopAtEnd = true
    synth.play(0, 0)
    const l = new Float32Array(SR * 2)
    synth.render(l, new Float32Array(SR * 2), l.length)
    expect(level(l, 0.3, 1.3)).toBeLessThan(db(4 / 1024) - 15)
    // el modelo limpio lo reproduce a su nivel real: unos 20 dB más bajo
    expect(level(render(song, 'clean').l, 0.3, 1.3)).toBeLessThan(db(4 / 1024) - 15)
  })

  it('un canal mandado a un lado deja su signo en el otro; en limpio, silencio', () => {
    const song = tune({ fm1: long(69) }, (s) => {
      sinePatch(s, 0)
      s.tracks[0].pan = 'L'
    })
    const md1 = render(song, 'md1', 2, false)
    expect(level(md1.l, 0.3, 1.3)).toBeGreaterThan(-17)
    expect(Math.abs(level(md1.r, 0.3, 1.3) - db(4 / 1024))).toBeLessThan(1)
    const clean = render(song, 'clean')
    expect(level(clean.l, 0.3, 1.3)).toBeGreaterThan(-17)
    expect(level(clean.r, 0.3, 1.3)).toBeLessThan(-100)
  })

  it('a volumen normal los dos modelos dan el mismo nivel', () => {
    const song = tune({ fm1: long(57) }, (s) => sinePatch(s, 0))
    expect(Math.abs(level(render(song, 'md1').l, 0.3, 1.3) - level(render(song, 'clean').l, 0.3, 1.3))).toBeLessThan(0.3)
  })

  it(`paso-bajo de primer orden a ${MD1_LOWPASS_HZ} Hz: −3 dB en el corte y 6 dB por octava`, () => {
    const loss = (note: number): number => {
      const song = tune({ fm1: long(note) }, (s) => sinePatch(s, 0))
      return level(render(song, 'md1', 2, true).l, 0.3, 1.3) - level(render(song, 'md1', 2, false).l, 0.3, 1.3)
    }
    const analog = (hz: number): number => -10 * Math.log10(1 + (hz / MD1_LOWPASS_HZ) ** 2)
    expect(loss(69)).toBeGreaterThan(-0.3)
    // Sol♯7 (3322 Hz) cae casi en el corte
    expect(Math.abs(loss(104) - analog(midiToHz(104)))).toBeLessThan(0.5)
    expect(loss(104)).toBeLessThan(-2.4)
    expect(loss(104)).toBeGreaterThan(-3.4)
    expect(Math.abs(loss(110) - analog(midiToHz(110)))).toBeLessThan(0.8)
  })

  it('arranca en silencio: la continua del DAC en reposo no da un golpe al empezar', () => {
    for (const model of ['md1', 'clean'] as const) {
      const { l, r } = render(tune({}), model, 0.5)
      let pk = 0
      for (let i = 0; i < l.length; i++) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]))
      expect(pk, model).toBeLessThan(0.0005)
    }
  })

  it('cambiar de modelo en marcha no da un chasquido, ni en silencio ni con una nota sonando', () => {
    const maxStep = (x: Float32Array, a: number, b: number): number => {
      let m = 0
      for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]))
      return m
    }
    for (const [from, to] of [['clean', 'md1'], ['md1', 'clean']] as const) {
      const quiet = new Synth(SR, tune({}), from)
      const l = new Float32Array(SR / 2)
      const r = new Float32Array(SR / 2)
      quiet.render(l, r, 4096)
      quiet.setModel(to)
      quiet.render(l, r, l.length)
      let pk = 0
      for (let i = 0; i < l.length; i++) pk = Math.max(pk, Math.abs(l[i]))
      expect(pk, `${from} → ${to} en silencio`).toBeLessThan(0.0005)

      // con un La grave a tope: el salto mayor tras el cambio no pasa del propio de la onda más,
      // como mucho, un escalón del DAC discreto (7 LSB), que es lo que aparece o desaparece
      const song = tune({ fm1: [{ step: 0, len: 14, note: 45, vel: 15 }] }, (s) => sinePatch(s, 0))
      const steady = render(song, to, 1)
      const synth = new Synth(SR, song, from)
      synth.stopAtEnd = true
      synth.play(0, 0)
      const a = new Float32Array(SR)
      const b = new Float32Array(SR)
      const cut = Math.round(SR * 0.4)
      synth.render(a, b, cut)
      synth.setModel(to)
      synth.render(a, b, SR - cut, cut)
      expect(maxStep(a, cut - 4, cut + 400), `${from} → ${to} sonando`).toBeLessThan((maxStep(steady.l, Math.round(SR * 0.5), Math.round(SR * 0.9)) + 7 / 1024) * 1.05)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('PSG calibrado a la consola', () => {
  const square = (s: Song): void => {
    s.psgBank[0] = { name: 'SQ', vol: 15, a: 0, d: 0, s: 0, r: 0, detune: 0 }
    s.tracks.find((t) => t.id === 'sq1')!.inst = 0
  }

  it('un canal de PSG a tope queda 10,9 dB por debajo de uno de FM (7,9 dB en RMS, cuadrada contra seno)', () => {
    expect(db((0.5 * PSG_GAIN) / 0.25)).toBeCloseTo(-10.9, 1)
    const fm = level(render(tune({ fm1: [{ step: 0, len: 14, note: 69, vel: 15 }] }, (s) => sinePatch(s, 0)), 'clean').l, 0.3, 1.3)
    const psg = level(render(tune({ sq1: [{ step: 0, len: 14, note: 69, vel: 15 }] }, square), 'clean').l, 0.3, 1.3)
    expect(psg - fm).toBeGreaterThan(-8.4)
    expect(psg - fm).toBeLessThan(-7.4)
  })

  it('las notas que el chip daría desafinadas bajan de octava; las afinadas no se tocan', () => {
    // el periodo es un entero de 10 bits: a partir de Fa♯6 los saltos son mayores que la afinación
    expect(Math.abs(psgCents(89))).toBeLessThan(PSG_MAX_CENTS)
    expect(psgInTune(89)).toBe(89)
    expect(Math.abs(psgCents(90))).toBeGreaterThan(PSG_MAX_CENTS)
    expect(psgInTune(90)).toBe(78)
    expect(psgInTune(96)).toBe(84)
    for (let n = 45; n <= 88; n++) expect(psgInTune(n), `nota ${n}`).toBe(n)
    // ningún tema generado lleva una nota de PSG fuera de afinación
    for (const st of STYLES) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const song = generateSong({ style: st.id, seed, key: (seed * 5) % 12 })
        for (const t of song.tracks.filter((x) => x.kind === 'psg')) {
          for (const p of song.patterns) for (const n of p.notes[t.id] ?? []) expect(Math.abs(psgCents(n.note + t.transpose)), `${st.id} #${seed} ${p.name} ${t.id} nota ${n.note}`).toBeLessThanOrEqual(PSG_MAX_CENTS)
        }
      }
    }
  })

  it('un tema de la versión anterior conserva su balance: sube el PSG lo que el chip permite', () => {
    const gain = Math.pow(10, PSG_RECAL_DB / 20)
    const old = JSON.parse(JSON.stringify(tune({ sq1: [{ step: 0, len: 2, note: 60, vel: 10 }], sq2: [{ step: 0, len: 2, note: 60, vel: 6 }, { step: 4, len: 2, note: 60, vel: 12 }], noise: [{ step: 0, len: 1, note: 0, vel: 5 }], fm1: [{ step: 0, len: 2, note: 40, vel: 9 }] }))) as Song
    old.version = 1
    const vol = (id: string, v?: number): number => {
      const t = old.tracks.find((x) => x.id === id)!
      if (v !== undefined) t.vol = v
      return t.vol
    }
    vol('sq1', 30)
    vol('sq2', 80)
    vol('noise', 100)
    vol('fm1', 70)
    const now = sanitizeSong(JSON.parse(JSON.stringify(old)), createEmptySong())
    expect(now.version).toBe(SONG_VERSION)
    const tr = (id: string) => now.tracks.find((x) => x.id === id)!
    const notes = (id: string) => now.patterns[0].notes[id].map((n) => n.vel)
    // con margen: todo va al volumen de la pista y las notas no cambian
    expect(tr('sq1').vol).toBe(Math.round(30 * gain))
    expect(notes('sq1')).toEqual([10])
    // sin margen: la pista llega a 100 y el resto lo ponen las velocidades (hasta 15)
    expect(tr('sq2').vol).toBe(100)
    expect(notes('sq2')).toEqual([Math.round(6 * gain * 0.8), 15])
    expect(tr('noise').vol).toBe(100)
    expect(notes('noise')).toEqual([Math.round(5 * gain)])
    // el FM no se toca
    expect(tr('fm1').vol).toBe(70)
    expect(notes('fm1')).toEqual([9])
    // y un tema ya calibrado no se vuelve a subir
    const again = sanitizeSong(JSON.parse(JSON.stringify(now)), createEmptySong())
    expect(again.tracks.map((t) => t.vol)).toEqual(now.tracks.map((t) => t.vol))
    expect(again.patterns[0].notes).toEqual(now.patterns[0].notes)
    // lo mismo si llega por un enlace antiguo (JSON a secas, con su número de versión)
    const link = Buffer.from(deflateSync(strToU8(JSON.stringify({ ...packSong(old), v: 1 })), { level: 9 })).toString('base64url')
    expect(songFromHash(link).tracks.find((x) => x.id === 'sq1')!.vol).toBe(Math.round(30 * gain))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('expresión: ligaduras y portamento', () => {
  const KEY = 0x28
  const two = (slide: boolean, glide: number, gap = 0): Song =>
    tune({ fm1: [{ step: 0, len: 4, note: 60, vel: 13 }, { step: 4 + gap, len: 6, note: 67, vel: 13, ...(slide ? { slide: true } : {}) }] }, (s) => {
      s.tracks[0].glide = glide
      s.tracks[0].gate = 0.5
    })
  const keyOns = (song: Song): number[] => writes(song, 0, KEY).filter(([, v]) => v === 0xf0).map(([t]) => t)
  const keyOffs = (song: Song): number[] => writes(song, 0, KEY).filter(([, v]) => v === 0x00).map(([t]) => t)

  it('FM: la nota ligada no vuelve a atacar (ni key-off ni key-on) y la anterior se sostiene hasta ella', () => {
    expect(keyOns(two(false, 0))).toHaveLength(2)
    const song = two(true, 0)
    const on = keyOns(song)
    expect(on).toHaveLength(1)
    // ningún key-off entre el ataque y el final de la segunda nota, aunque el gate sea del 50 %
    const between = keyOffs(song).filter((t) => t > on[0] && t < 4 * STEP + 2 * STEP)
    expect(between).toHaveLength(0)
    // la segunda nota sí se corta donde le toca (gate 50 % de 6 pasos)
    expect(keyOffs(song).some((t) => Math.abs(t - (4 * STEP + 3 * STEP)) < 64)).toBe(true)
  })

  it('FM: sin GLIDE la altura salta de golpe; con GLIDE se desliza de una nota a la otra en ese tiempo', () => {
    const freqWrites = (song: Song): number[] => writes(song, 0, 0xa0).filter(([t]) => t >= 4 * STEP - 1).map(([t]) => t)
    expect(freqWrites(two(true, 0))).toHaveLength(1)
    const glided = freqWrites(two(true, 6))
    // un valor por frame durante seis frames, y ninguno después
    expect(glided.length).toBeGreaterThanOrEqual(6)
    expect(glided.length).toBeLessThanOrEqual(7)
    expect(glided[glided.length - 1] - glided[0]).toBeLessThan((6.5 * SR) / 60)
    // acaba exactamente en la nota escrita
    const hi = writes(two(true, 6), 0, 0xa4)
    const lo = writes(two(true, 6), 0, 0xa0)
    const last = ((hi[hi.length - 1][1] & 7) << 8) | lo[lo.length - 1][1]
    expect(last).toBe(ymFreqFromHz(midiToHz(67)).fnum)
    // y en el audio: a mitad del deslizamiento suena entre las dos notas
    const { l } = render(two(true, 12), 'clean', 1.4)
    const mid = peakFreq(l.subarray(Math.round(4 * STEP + (4 * SR) / 60), Math.round(4 * STEP + (8 * SR) / 60)), SR, 100)
    expect(mid).toBeGreaterThan(midiToHz(61))
    expect(mid).toBeLessThan(midiToHz(66))
    const end = peakFreq(l.subarray(Math.round(6 * STEP), Math.round(7 * STEP)), SR, 100)
    expect(Math.abs(1200 * Math.log2(end / midiToHz(67)))).toBeLessThan(8)
  })

  it('una nota ligada tras un silencio ataca como cualquier otra', () => {
    expect(keyOns(two(true, 6, 2))).toHaveLength(2)
  })

  it('PSG: la ligada mantiene la envolvente y cambia el periodo, deslizándose si hay GLIDE', () => {
    const song = (slide: boolean, glide: number): Song =>
      tune({ sq1: [{ step: 0, len: 4, note: 60, vel: 15 }, { step: 4, len: 6, note: 67, vel: 15, ...(slide ? { slide: true } : {}) }] }, (s) => {
        const t = s.tracks.find((x) => x.id === 'sq1')!
        t.inst = 0
        t.glide = glide
        t.gate = 0.5
        s.psgBank[0] = { name: 'SQ', vol: 15, a: 0, d: 0, s: 0, r: 0, detune: 0 }
      })
    // canal 0: 1001vvvv = atenuación (15 = silencio) · 1000dddd = periodo (4 bits bajos)
    const muted = (s: Song): number[] => psgWrites(s).filter(([t, b]) => b === 0x9f && t > 0 && t < 6 * STEP).map(([t]) => t)
    const tones = (s: Song): number[] => psgWrites(s).filter(([t, b]) => (b & 0xf0) === 0x80 && t >= 4 * STEP - 1).map(([t]) => t)
    // suelta: el gate la calla a mitad de la primera nota
    expect(muted(song(false, 0)).length).toBeGreaterThan(0)
    // ligada: el canal no se calla entre las dos
    expect(muted(song(true, 0))).toHaveLength(0)
    expect(tones(song(true, 0))).toHaveLength(1)
    expect(tones(song(true, 6)).length).toBeGreaterThanOrEqual(5)
  })
})

describe('expresión: panorama por nota', () => {
  const PAN = 0xb4

  it('FM: cada nota escribe su panorama antes de sonar; sin panorama propio vale el de la pista', () => {
    const song = tune({
      fm1: [
        { step: 0, len: 2, note: 60, vel: 13, pan: 'L' },
        { step: 4, len: 2, note: 60, vel: 13, pan: 'R' },
        { step: 8, len: 2, note: 60, vel: 13 },
        { step: 12, len: 2, note: 60, vel: 13, pan: 'L' },
      ],
    })
    const seq = writes(song, 0, PAN).filter(([t]) => t > 0 || true).map(([, v]) => v >> 6)
    // L = bit alto · R = bit bajo · centro = los dos
    expect(seq.slice(-4)).toEqual([2, 1, 3, 2])
    const { l, r } = render(song, 'clean', 2)
    const t = (step: number): [number, number] => [(step * STEP) / SR + 0.02, ((step + 1.5) * STEP) / SR]
    expect(level(r, ...t(0))).toBeLessThan(-90)
    expect(level(l, ...t(0))).toBeGreaterThan(-30)
    expect(level(l, ...t(4))).toBeLessThan(-90)
    expect(level(r, ...t(4))).toBeGreaterThan(-30)
    expect(Math.abs(level(l, ...t(8)) - level(r, ...t(8)))).toBeLessThan(0.1)
  })

  it('batería: el golpe con panorama mueve el canal del DAC entero', () => {
    const song = tune({ ch6: [{ step: 0, len: 1, note: 0, vel: 15, pan: 'R' }, { step: 8, len: 1, note: 1, vel: 15, pan: 'L' }] })
    const seq = writes(song, 1, PAN + 2).map(([, v]) => v >> 6)
    expect(seq.slice(-2)).toEqual([1, 2])
  })
})

describe('expresión: la velocidad abre el timbre', () => {
  const TL = [0x40, 0x48, 0x44, 0x4c]
  const tl = (inst: number, vel: number): number[] => {
    const song = tune({ fm1: [{ step: 0, len: 4, note: 48, vel }] }, (s) => (s.tracks[0].inst = inst))
    return TL.map((reg) => {
      const w = writes(song, 0, reg)
      return w[w.length - 1][1]
    })
  }

  it('con velMod, tocar fuerte baja el TL de los moduladores y tocar suave lo sube; las portadoras solo llevan el volumen', () => {
    const p = FM_PRESETS[FM.SLAP]
    expect(p.alg).toBe(4)
    expect(p.velMod).toBeGreaterThan(0)
    const soft = tl(FM.SLAP, 6)
    const ref = tl(FM.SLAP, 12)
    const loud = tl(FM.SLAP, 15)
    // algoritmo 4: operadores 1 y 3 modulan, 2 y 4 suenan
    for (const m of [0, 2]) {
      expect(ref[m]).toBe(p.ops[m].tl)
      expect(loud[m]).toBeLessThan(ref[m])
      expect(soft[m]).toBeGreaterThan(ref[m])
      expect(soft[m] - loud[m]).toBe(Math.round((p.velMod! * 6) / 15 / 0.75) + Math.round((p.velMod! * 3) / 15 / 0.75))
    }
    for (const c of [1, 3]) {
      expect(loud[c]).toBe(p.ops[c].tl)
      // 20·log10(6/15) = −8 dB → 11 pasos de 0,75 dB
      expect(soft[c] - loud[c]).toBe(11)
    }
  })

  it('sin velMod los moduladores no se mueven', () => {
    const p = FM_PRESETS[FM.EPIANO]
    expect(p.velMod).toBeUndefined()
    const soft = tl(FM.EPIANO, 6)
    const loud = tl(FM.EPIANO, 15)
    const carriers = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]][p.alg]
    for (let op = 0; op < 4; op++) if (!carriers.includes(op)) expect(soft[op]).toBe(loud[op])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('la articulación viaja con el tema', () => {
  const song = (): Song =>
    tune(
      {
        fm1: [
          { step: 0, len: 2, note: 40, vel: 12 },
          { step: 2, len: 2, note: 52, vel: 9, slide: true },
          { step: 4, len: 1, note: 40, vel: 15, pan: 'L' },
          { step: 5, len: 1, note: 43, vel: 1, slide: true, pan: 'R' },
          { step: 6, len: 1, note: 40, vel: 7, pan: 'C' },
        ],
        sq1: [{ step: 0, len: 4, note: 72, vel: 10 }, { step: 4, len: 4, note: 74, vel: 10, slide: true }],
      },
      (s) => {
        s.tracks[0].glide = 4
        s.tracks.find((t) => t.id === 'sq1')!.glide = 17
        s.fmBank[1].velMod = 9
      },
    )

  it('enlace compartido, autoguardado y proyecto conservan ligaduras, panorama, glide y velMod', () => {
    const src = song()
    for (const back of [songFromHash(songToHash(src)), unpackSong(JSON.parse(JSON.stringify(packSong(src)))), sanitizeSong(JSON.parse(JSON.stringify(src)), createEmptySong())]) {
      expect(back.patterns[0].notes.fm1).toEqual(src.patterns[0].notes.fm1)
      expect(back.patterns[0].notes.sq1).toEqual(src.patterns[0].notes.sq1)
      expect(back.tracks.map((t) => t.glide)).toEqual(src.tracks.map((t) => t.glide))
      expect(back.fmBank[1].velMod).toBe(9)
    }
    // una nota sin articulación no gana campos de más
    expect(Object.keys(songFromHash(songToHash(src)).patterns[0].notes.fm1[0]).sort()).toEqual(['len', 'note', 'step', 'vel'])
  })

  it('el enlace es binario, más corto que el JSON de antes, y los JSON antiguos se siguen leyendo', () => {
    for (const st of STYLES) {
      const s = generateSong({ style: st.id, seed: 12, key: 3 })
      const hash = songToHash(s)
      const json = Buffer.from(deflateSync(strToU8(JSON.stringify(packSong(s))), { level: 9 })).toString('base64url')
      expect(hash.length, st.id).toBeLessThan(json.length * 0.85)
      expect(songFromHash(json).patterns.map((p) => p.notes), st.id).toEqual(s.patterns.map((p) => p.notes))
      expect(songFromHash(hash).patterns.map((p) => p.notes), st.id).toEqual(s.patterns.map((p) => p.notes))
      // cabe en un mensaje de cualquier chat junto con la dirección de la app
      expect(hash.length, st.id).toBeLessThan(3000)
    }
  })

  it('un enlace cortado o corrupto no rompe nada: se ignora', () => {
    const hash = songToHash(generateSong({ style: 'cosmic', seed: 2, key: 0 }))
    expect(songFromLocationHash(`#s=${hash}`)).not.toBeNull()
    expect(songFromLocationHash(`#s=${hash.slice(0, hash.length >> 1)}`)).toBeNull()
    expect(songFromLocationHash('#s=AAAA')).toBeNull()
    // contenedor desconocido
    const odd = Buffer.from(deflateSync(new Uint8Array([9, 1, 2, 3]))).toString('base64url')
    expect(songFromLocationHash(`#s=${odd}`)).toBeNull()
    // binario truncado tras la cabecera
    const cut = Buffer.from(deflateSync(new Uint8Array([2, 200, 1, 123]))).toString('base64url')
    expect(songFromLocationHash(`#s=${cut}`)).toBeNull()
  })
})
