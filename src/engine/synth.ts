// ── Synth: driver de sonido + secuenciador + consola de chips ────────────────
//
// Es el "sound driver" de la Mega Drive: lee la canción, convierte notas en
// escrituras de registros YM2612 / SN76489 y las envía a la consola emulada.
// Toda la temporización es en MUESTRAS DE SALIDA (determinista y exacta).
//
// El mismo código sirve para:
//   · tiempo real en el AudioWorklet,
//   · render offline a WAV (y stems),
//   · exportación VGM: cada escritura de registro se puede registrar con su
//     marca de tiempo (`log`), así el VGM suena igual que la previsualización.
import { midiToHz, psgPeriodFromHz, ymFreqFromHz } from '../core/chipmath'
import { ChipConsole, type SoundModel } from '../core/mixer'
import {
  getPattern,
  patternSteps,
  type FmPatch,
  type Note,
  type Pan,
  type Pattern,
  type PitchEnv,
  type Song,
  type Track,
  type Vibrato,
} from '../music/song'
import { renderDrum } from './drums'

/** 0 = YM2612 puerto 0 · 1 = YM2612 puerto 1 · 2 = SN76489 */
export type WriteKind = 0 | 1 | 2
export type WriteLogger = (t: number, kind: WriteKind, a: number, b: number) => void

const FRAME_HZ = 60
const OP_REG = [0, 8, 4, 12]
const CARRIERS: number[][] = [
  [0, 0, 0, 1],
  [0, 0, 0, 1],
  [0, 0, 0, 1],
  [0, 0, 0, 1],
  [0, 1, 0, 1],
  [0, 1, 1, 1],
  [0, 1, 1, 1],
  [1, 1, 1, 1],
]
const FM_STEP_DB = 0.75
const PSG_STEP_DB = 2
const PSG_LOWEST_HZ = 111
const PAN_BITS = { C: 3, L: 2, R: 1 } as const
/** velocidad a la que un parche con velMod suena tal como esta escrito (por encima se abre, por debajo se cierra) */
const VEL_REF = 12
/** margen (muestras) que se sostiene una nota esperando a la ligada que viene detrás */
const TIE_MARGIN = 48

/** deslizamiento de una nota ligada: de dónde viene y cuántos frames lleva */
interface Glide {
  glideFrom: number
  glideAge: number
  glideLen: number
}
/** lo que le falta por recorrer al deslizamiento, en semitonos, respecto a la nota de destino */
const glideOffset = (g: Glide, target: number): number => (g.glideAge < g.glideLen ? (g.glideFrom - target) * (1 - g.glideAge / g.glideLen) : 0)

interface FmState extends Glide {
  on: boolean
  keyed: boolean
  track: number
  patch: FmPatch | null
  notes: number[]
  age: number
  vel: number
  att: number
  /** bits L/R con los que suena (el de la nota o el de la pista) */
  pan: number
  offAt: number
  fnum: number
  block: number
}

interface PsgState extends Glide {
  on: boolean
  keyed: boolean
  track: number
  notes: number[]
  age: number
  relAge: number
  relLevel: number
  vel: number
  att: number
  offAt: number
  period: number
  /** parámetros de envolvente congelados en el note-on */
  vol: number
  a: number
  d: number
  s: number
  r: number
  vib?: Vibrato
  pitchEnv?: PitchEnv
  detune: number
  lastAtt: number
}

interface DacVoice {
  pcm: Float32Array
  pos: number
  gain: number
}

interface LiveHold {
  notes: number[]
  vel: number
}

type StartsMap = Map<number, Note[]>
const startsCache = new WeakMap<Pattern, Map<string, StartsMap>>()

function startsFor(p: Pattern, trackId: string): StartsMap {
  let per = startsCache.get(p)
  if (!per) {
    per = new Map()
    startsCache.set(p, per)
  }
  let m = per.get(trackId)
  if (!m) {
    m = new Map()
    for (const n of p.notes[trackId] ?? []) {
      const arr = m.get(n.step)
      if (arr) arr.push(n)
      else m.set(n.step, [n])
    }
    per.set(trackId, m)
  }
  return m
}

export function isTrackAudible(song: Song, idx: number): boolean {
  const t = song.tracks[idx]
  if (!t) return false
  const anySolo = song.tracks.some((x) => x.solo)
  return anySolo ? t.solo : !t.mute
}

const volToSteps = (vol01: number, stepDb: number): number => {
  if (vol01 <= 0.0005) return 127
  return Math.max(0, Math.round((-20 * Math.log10(vol01)) / stepDb))
}

export class Synth {
  readonly sampleRate: number
  readonly con: ChipConsole
  song: Song
  /** si se asigna, recibe cada escritura de registro con su marca de tiempo */
  log: WriteLogger | null = null

  // ── tiempo ──
  private t = 0
  private readonly frameLen: number
  private nextFrame = 0

  // ── transporte ──
  playing = false
  /** al llegar al final del orden: false = vuelve a loopStart · true = para */
  stopAtEnd = false
  private order = 0
  private stepIdx = 0
  /** paso que está sonando ahora (stepIdx es el SIGUIENTE a disparar) */
  private curOrder = 0
  private curStep = 0
  private nextStep = 0
  private stepStart = 0
  /** se incrementa cada vez que el orden da la vuelta (para exportar un solo ciclo) */
  loops = 0
  onStop: (() => void) | null = null
  /** se llama al entrar en cada posición del orden (índice, muestra) */
  onOrder: ((order: number, t: number) => void) | null = null
  /** cada golpe de batería PCM (muestra, sonido del kit, ganancia 0-1): lo usa el exportador XGM */
  onDrum: ((t: number, drum: number, gain: number) => void) | null = null

  // ── metrónomo (solo se mezcla en render(); nunca llega a los chips ni al VGM) ──
  metronome = false
  /** pasos de cuenta atrás antes de empezar a secuenciar */
  private preroll = 0
  private clickPh = 0
  private clickInc = 0
  private clickEnv = 0
  private readonly clickDecay: number

  // ── chips ──
  private readonly shadow: Int16Array[] = [new Int16Array(256).fill(-1), new Int16Array(256).fill(-1)]
  private readonly fm: FmState[] = []
  private readonly psg: PsgState[] = []
  private noise: PsgState
  private psgTone = new Int32Array(3).fill(-1)
  private dacEnabled = false
  private dacLast = 128
  private dacVoices: DacVoice[] = []
  private dacNext = 0
  private readonly pcmCache = new Map<string, Float32Array>()

  // ── notas en directo ──
  private readonly live = new Map<number, LiveHold>()

  constructor(sampleRate: number, song: Song, model: SoundModel = 'md1') {
    this.sampleRate = sampleRate
    this.song = song
    this.con = new ChipConsole({ sampleRate, model })
    this.frameLen = sampleRate / FRAME_HZ
    this.clickDecay = Math.exp(-1 / (0.022 * sampleRate))
    for (let i = 0; i < 6; i++) this.fm.push(this.newFm())
    for (let i = 0; i < 3; i++) this.psg.push(this.newPsg())
    this.noise = this.newPsg()
    this.reset()
  }

  private newFm(): FmState {
    return { on: false, keyed: false, track: -1, patch: null, notes: [], age: 0, vel: 12, att: 0, pan: 3, offAt: Infinity, fnum: -1, block: -1, glideFrom: 0, glideAge: 0, glideLen: 0 }
  }
  private newPsg(): PsgState {
    return {
      on: false,
      keyed: false,
      track: -1,
      notes: [],
      age: 0,
      relAge: 0,
      relLevel: 0,
      vel: 12,
      att: 0,
      offAt: Infinity,
      period: -1,
      vol: 13,
      a: 0,
      d: 0,
      s: 0,
      r: 0,
      detune: 0,
      lastAtt: -1,
      glideFrom: 0,
      glideAge: 0,
      glideLen: 0,
    }
  }

  /** Reinicia chips y estado del driver (conserva la canción). */
  reset(): void {
    this.con.reset()
    this.shadow[0].fill(-1)
    this.shadow[1].fill(-1)
    this.psgTone.fill(-1)
    this.dacEnabled = false
    this.dacLast = 128
    this.dacVoices = []
    this.live.clear()
    for (let i = 0; i < 6; i++) this.fm[i] = this.newFm()
    for (let i = 0; i < 3; i++) this.psg[i] = this.newPsg()
    this.noise = this.newPsg()
    this.playing = false
    this.t = 0
    this.nextFrame = 0
    this.nextStep = 0
    this.loops = 0
    this.initChips()
  }

  private applyLfo(): void {
    const l = this.song.lfo | 0
    this.ymW(0, 0x22, l > 0 ? 0x08 | ((l - 1) & 7) : 0)
  }

  private initChips(): void {
    this.applyLfo()
    this.ymW(0, 0x27, 0)
    this.ymW(0, 0x2b, 0)
    for (let c = 0; c < 6; c++) this.ymW(0, 0x28, c < 3 ? c : c + 1, true)
    for (let c = 0; c < 4; c++) this.psgW(0x90 | (c << 5) | 15)
  }

  setSong(song: Song): void {
    const lfoChanged = song.lfo !== this.song.lfo
    this.song = song
    if (lfoChanged) this.applyLfo()
    // si FM6 deja de ser el DAC de batería, devolvemos el canal al modo FM
    const ch6 = song.tracks.find((t) => t.id === 'ch6')
    if (this.dacEnabled && ch6 && ch6.kind !== 'dac') {
      this.dacEnabled = false
      this.dacVoices = []
      this.ymW(0, 0x2b, 0)
    }
    if (this.playing) {
      if (this.order >= song.order.length) this.order = Math.max(0, song.order.length - 1)
    }
  }

  get time(): number {
    return this.t
  }

  /** carácter de sonido de la consola: Model 1 (DAC discreto + paso-bajo) o limpio */
  setModel(model: SoundModel): void {
    if (this.con.model !== model) this.con.model = model
  }

  // ── escritura a los chips ─────────────────────────────────────────────────
  private ymW(port: 0 | 1, reg: number, val: number, force = false): void {
    const sh = this.shadow[port]
    if (!force && sh[reg] === val) return
    sh[reg] = val
    this.con.ym.write(port, reg, val)
    this.log?.(this.t, port, reg, val)
  }

  private psgW(b: number): void {
    this.con.psg.write(b)
    this.log?.(this.t, 2, b, 0)
  }

  private psgSetTone(ch: number, period: number): void {
    if (this.psgTone[ch] === period) return
    this.psgTone[ch] = period
    this.psgW(0x80 | (ch << 5) | (period & 15))
    this.psgW((period >> 4) & 0x3f)
  }

  private psgSetAtt(ch: number, att: number): void {
    this.psgW(0x90 | (ch << 5) | (att & 15))
  }

  // ── transporte ────────────────────────────────────────────────────────────
  play(order = 0, step = 0, prerollSteps = 0): void {
    this.preroll = prerollSteps
    this.stopSequenceVoices()
    this.order = Math.max(0, Math.min(order, this.song.order.length - 1))
    this.stepIdx = step
    this.curOrder = this.order
    this.curStep = step
    this.nextStep = this.t
    this.stepStart = this.t
    this.playing = true
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    this.stopSequenceVoices()
    this.onStop?.()
  }

  /** silencia todo lo que no sea una nota en directo */
  private stopSequenceVoices(): void {
    for (let c = 0; c < 6; c++) {
      const f = this.fm[c]
      if (f.on && !this.isLiveTrack(f.track)) this.fmKeyOff(c)
    }
    for (let c = 0; c < 3; c++) {
      const p = this.psg[c]
      if (p.on && !this.isLiveTrack(p.track)) {
        p.on = false
        p.keyed = false
        this.psgSetAtt(c, 15)
        p.lastAtt = 15
      }
    }
    if (this.noise.on && !this.isLiveTrack(this.noise.track)) {
      this.noise.on = false
      this.noise.keyed = false
      this.psgSetAtt(3, 15)
      this.noise.lastAtt = 15
    }
    this.dacVoices = []
  }

  private isLiveTrack(track: number): boolean {
    return (this.live.get(track)?.notes.length ?? 0) > 0
  }

  panic(): void {
    this.live.clear()
    for (let c = 0; c < 6; c++) this.fmKeyOff(c)
    for (let c = 0; c < 4; c++) {
      this.psgSetAtt(c, 15)
      const s = c < 3 ? this.psg[c] : this.noise
      s.on = false
      s.keyed = false
      s.lastAtt = 15
    }
    this.dacVoices = []
  }

  private computeStepDur(stepInPattern: number): number {
    const base = (60 * this.sampleRate) / (this.song.bpm * 4)
    const sw = this.song.swing
    // celda de swing de 2 pasos (semicorcheas) o de 4 (corcheas): la primera mitad se alarga y la segunda se acorta
    const g = this.song.swingGrid === 4 ? 4 : 2
    return stepInPattern % g < g / 2 ? base * (1 + sw) : base * (1 - sw)
  }

  /** posición actual de reproducción (para el cursor de la UI) */
  position(): { order: number; step: number; frac: number } {
    const span = this.nextStep - this.stepStart
    const frac = span > 0 ? Math.max(0, Math.min(1, (this.t - this.stepStart) / span)) : 0
    return { order: this.curOrder, step: this.curStep, frac }
  }

  // ── bucle por muestra ─────────────────────────────────────────────────────
  /** Avanza el reloj del driver una muestra (sin generar audio). */
  private advance(): void {
    const t = this.t
    // 1) fin de nota (antes de nuevos note-on para permitir re-disparo limpio)
    for (let c = 0; c < 6; c++) {
      const f = this.fm[c]
      if (f.keyed && t >= f.offAt) this.fmKeyOff(c)
    }
    for (let c = 0; c < 3; c++) {
      const p = this.psg[c]
      if (p.keyed && t >= p.offAt) this.psgRelease(p)
    }
    if (this.noise.keyed && t >= this.noise.offAt) this.psgRelease(this.noise)

    // 2) paso del secuenciador
    if (this.playing && t >= this.nextStep) this.triggerStep()

    // 3) frame de 60 Hz (envolventes, vibrato, arpegios)
    if (t >= this.nextFrame) {
      this.frameTick()
      this.nextFrame += this.frameLen
    }

    // 4) DAC
    if (this.dacVoices.length > 0 && t >= this.dacNext) {
      this.dacTick()
      this.dacNext += this.sampleRate / this.song.dacRate
    }
    this.t = t + 1
  }

  /** Avanza `n` muestras generando audio. */
  render(outL: Float32Array, outR: Float32Array, n: number, offset = 0): void {
    const con = this.con
    for (let i = 0; i < n; i++) {
      this.advance()
      con.renderSample()
      let l = con.l
      let r = con.r
      if (this.clickEnv > 1e-4) {
        const c = Math.sin(this.clickPh) * this.clickEnv * 0.35
        this.clickPh += this.clickInc
        this.clickEnv *= this.clickDecay
        l += c
        r += c
      }
      outL[offset + i] = l
      outR[offset + i] = r
    }
  }

  private click(accent: boolean): void {
    this.clickInc = (2 * Math.PI * (accent ? 1760 : 1175)) / this.sampleRate
    this.clickPh = 0
    this.clickEnv = accent ? 1 : 0.7
  }

  /** Avanza `n` muestras sin audio (para volcar solo las escrituras de registros). */
  advanceOnly(n: number): void {
    for (let i = 0; i < n; i++) this.advance()
  }

  // ── secuenciador ──────────────────────────────────────────────────────────
  private triggerStep(): void {
    const song = this.song
    // Un paso por llamada. Si el patrón actual terminó (el final se detecta
    // en el instante exacto en que acaba el último paso), pasamos al siguiente
    // sin perder ni una muestra de sincronía.
    if (this.preroll > 0) {
      // cuenta atrás: solo metrónomo
      if (this.preroll % 4 === 0) this.click(this.preroll % (song.beatsPerBar * 4) === 0)
      this.stepStart = this.nextStep
      this.nextStep += this.computeStepDur(0)
      this.preroll--
      return
    }
    for (let guard = 0; guard <= song.order.length + 1; guard++) {
      const pid = song.order[this.order]
      const pat = pid !== undefined ? getPattern(song, pid) : undefined
      const steps = pat ? patternSteps(song, pat) : 0
      if (!pat || this.stepIdx >= steps) {
        if (!this.advanceOrder()) return
        continue
      }
      if (this.stepIdx === 0) this.onOrder?.(this.order, this.t)
      const stepDur = this.computeStepDur(this.stepIdx)
      this.stepStart = this.nextStep
      this.curOrder = this.order
      this.curStep = this.stepIdx
      if (this.metronome && this.stepIdx % 4 === 0) this.click(this.stepIdx === 0)

      for (let ti = 0; ti < song.tracks.length; ti++) {
        const tr = song.tracks[ti]
        if (!isTrackAudible(song, ti) || this.isLiveTrack(ti)) continue
        const starts = startsFor(pat, tr.id).get(this.stepIdx)
        if (!starts || starts.length === 0) continue
        this.triggerTrack(ti, tr, starts, stepDur, pat)
      }

      this.nextStep += stepDur
      this.stepIdx++
      return
    }
  }

  /** Pasa al siguiente patrón del orden. Devuelve false si la canción terminó. */
  private advanceOrder(): boolean {
    const song = this.song
    this.order++
    this.stepIdx = 0
    if (this.order >= song.order.length) {
      this.loops++
      if (this.stopAtEnd || song.loopStart < 0) {
        this.order = Math.max(0, song.order.length - 1)
        this.playing = false
        this.onStop?.()
        return false
      }
      this.order = Math.min(song.loopStart, song.order.length - 1)
    }
    return true
  }

  private triggerTrack(ti: number, tr: Track, notes: Note[], stepDur: number, pat: Pattern): void {
    const maxLen = Math.max(...notes.map((n) => n.len))
    const vel = Math.max(...notes.map((n) => n.vel))
    if (tr.kind === 'dac') {
      for (const n of notes) this.dacTrigger(n.note, n.vel, tr, n.pan)
      return
    }
    if (tr.kind === 'noise') {
      this.noiseOn(ti, tr, notes[0].note, notes[0].vel, this.t + Math.max(1, maxLen * stepDur * tr.gate))
      return
    }
    // si la nota que viene justo detrás está ligada, esta se sostiene entera (sin el corte del
    // gate) hasta que la otra la releve; si esa no llega nunca, se suelta poco después
    const tied = startsFor(pat, tr.id).get(this.stepIdx + maxLen)?.some((n) => n.slide) ?? false
    let dur = maxLen * stepDur * tr.gate
    if (tied) {
      dur = TIE_MARGIN
      for (let i = 0; i < maxLen; i++) dur += this.computeStepDur(this.stepIdx + i)
    }
    const offAt = this.t + Math.max(1, dur)
    const slide = notes.some((n) => n.slide)
    const pan = notes.find((n) => n.pan)?.pan
    const semis = notes.map((n) => n.note + tr.transpose).sort((a, b) => a - b)
    if (tr.kind === 'fm') this.fmNoteOn(ti, tr, semis, vel, offAt, slide, pan)
    else this.psgNoteOn(ti, tr, semis, vel, offAt, slide)
  }

  // ── FM ────────────────────────────────────────────────────────────────────
  private fmPatchFor(tr: Track): FmPatch {
    const bank = this.song.fmBank
    return bank[tr.inst] ?? bank[0]
  }

  private fmPan(tr: Track, pan?: Pan): number {
    return PAN_BITS[pan ?? tr.pan] ?? 3
  }

  /**
   * Escribe el parche en el canal (solo llegan al chip los registros que cambian). La velocidad
   * atenúa las portadoras (volumen) y, si el parche tiene `velMod`, también los moduladores:
   * tocar suave cierra el timbre además de bajarlo.
   */
  private loadFmPatch(ch: number, p: FmPatch, pan: number, att: number, vel: number): void {
    const port = ch < 3 ? 0 : 1
    const c = ch % 3
    const car = CARRIERS[p.alg & 7]
    const mod = p.velMod ? Math.round((p.velMod * (VEL_REF - Math.min(15, vel))) / 15 / FM_STEP_DB) : 0
    for (let op = 0; op < 4; op++) {
      const o = p.ops[op]
      const r = OP_REG[op] + c
      this.ymW(port, 0x30 + r, (o.dt << 4) | o.mul)
      this.ymW(port, 0x40 + r, Math.max(0, Math.min(127, o.tl + (car[op] ? att : mod))))
      this.ymW(port, 0x50 + r, (o.rs << 6) | o.ar)
      this.ymW(port, 0x60 + r, (o.am << 7) | o.d1r)
      this.ymW(port, 0x70 + r, o.d2r)
      this.ymW(port, 0x80 + r, (o.sl << 4) | o.rr)
      this.ymW(port, 0x90 + r, 0)
    }
    this.ymW(port, 0xb0 + c, ((p.fb & 7) << 3) | (p.alg & 7))
    this.ymW(port, 0xb4 + c, (pan << 6) | ((p.ams & 3) << 4) | (p.pms & 7))
  }

  private fmFreq(ch: number, semi: number): void {
    const f = this.fm[ch]
    const { fnum, block } = ymFreqFromHz(midiToHz(Math.max(0, Math.min(127, semi))))
    if (fnum === f.fnum && block === f.block) return
    f.fnum = fnum
    f.block = block
    const port = ch < 3 ? 0 : 1
    const c = ch % 3
    this.ymW(port, 0xa4 + c, (block << 3) | (fnum >> 8))
    this.ymW(port, 0xa0 + c, fnum & 0xff)
  }

  private fmKeySel(ch: number): number {
    return ch < 3 ? ch : ch + 1
  }

  private fmKeyOff(ch: number): void {
    const f = this.fm[ch]
    if (f.on || f.keyed) this.ymW(0, 0x28, this.fmKeySel(ch), true)
    f.on = false
    f.keyed = false
    f.offAt = Infinity
  }

  private fmNoteOn(ti: number, tr: Track, semis: number[], vel: number, offAt: number, slide = false, pan?: Pan): void {
    const ch = tr.ch
    // FM6 ocupado por el DAC → no se puede usar
    if (ch === 5 && this.dacEnabled) return
    const f = this.fm[ch]
    const patch = this.fmPatchFor(tr)
    const vol = (tr.vol / 100) * (vel / 15)
    const att = volToSteps(vol, FM_STEP_DB)
    const panBits = this.fmPan(tr, pan)
    if (slide && f.keyed && f.track === ti && f.patch === patch) {
      // ligadura: la nota anterior sigue sonando y solo cambian la altura (deslizándose desde
      // donde esté), la dinámica y el panorama. Ni key-off ni key-on: la envolvente no se entera.
      const cur = f.notes.length ? f.notes[f.age % f.notes.length] : 60
      f.glideFrom = cur + glideOffset(f, cur)
      f.glideAge = 0
      f.glideLen = tr.glide
      f.notes = semis
      f.vel = vel
      f.att = att
      f.pan = panBits
      f.offAt = offAt
      this.loadFmPatch(ch, patch, panBits, att, vel)
      this.fmFreq(ch, this.fmSemi(f, patch, f.age))
      return
    }
    f.track = ti
    f.patch = patch
    f.notes = semis
    f.age = 0
    f.vel = vel
    f.att = att
    f.pan = panBits
    f.offAt = offAt
    f.glideLen = 0
    f.glideAge = 0
    this.loadFmPatch(ch, patch, panBits, att, vel)
    f.fnum = -1
    f.block = -1
    this.fmFreq(ch, this.fmSemi(f, patch, 0))
    // retrigger limpio
    this.ymW(0, 0x28, this.fmKeySel(ch), true)
    this.ymW(0, 0x28, 0xf0 | this.fmKeySel(ch), true)
    f.on = true
    f.keyed = true
  }

  /** semitono instantáneo (acordes en arpegio + deslizamiento + vibrato + envolvente de pitch) */
  private fmSemi(f: FmState, p: FmPatch, age: number): number {
    const n = f.notes.length ? f.notes[age % f.notes.length] : 60
    return n + glideOffset(f, n) + pitchOffset(p.vib, p.pitchEnv, age) / 100
  }

  // ── PSG / ruido ───────────────────────────────────────────────────────────
  private psgNoteOn(ti: number, tr: Track, semis: number[], vel: number, offAt: number, slide = false): void {
    const ch = tr.ch
    const inst = this.song.psgBank[tr.inst] ?? this.song.psgBank[0]
    const s = this.psg[ch]
    if (slide && s.keyed && s.track === ti) {
      // ligadura: la envolvente sigue donde estaba; cambian la altura y la dinámica
      const cur = s.notes.length ? s.notes[s.age % s.notes.length] : 60
      s.glideFrom = cur + glideOffset(s, cur)
      s.glideAge = 0
      s.glideLen = tr.glide
      s.notes = semis
      s.vel = vel
      s.offAt = offAt
      s.att = volToSteps((tr.vol / 100) * (vel / 15), PSG_STEP_DB)
      this.psgUpdatePitch(ch, s)
      this.psgUpdateLevel(ch, s)
      return
    }
    s.glideLen = 0
    s.glideAge = 0
    s.track = ti
    s.notes = semis
    s.age = 0
    s.relAge = 0
    s.vel = vel
    s.offAt = offAt
    s.vol = inst.vol
    s.a = inst.a
    s.d = inst.d
    s.s = inst.s
    s.r = inst.r
    s.vib = inst.vib
    s.pitchEnv = inst.pitchEnv
    s.detune = inst.detune
    s.att = volToSteps((tr.vol / 100) * (vel / 15), PSG_STEP_DB)
    s.on = true
    s.keyed = true
    s.lastAtt = -1
    this.psgUpdatePitch(ch, s)
    this.psgUpdateLevel(ch, s)
  }

  private psgPeriodFor(semi: number): number {
    let hz = midiToHz(semi)
    while (hz < PSG_LOWEST_HZ) hz *= 2
    return Math.max(2, psgPeriodFromHz(hz))
  }

  private psgUpdatePitch(ch: number, s: PsgState): void {
    const n = s.notes.length ? s.notes[s.age % s.notes.length] : 60
    const semi = n + glideOffset(s, n) + (pitchOffset(s.vib, s.pitchEnv, s.age) + s.detune) / 100
    this.psgSetTone(ch, this.psgPeriodFor(semi))
  }

  private psgLevel(s: PsgState): number {
    if (!s.keyed) {
      if (s.r <= 0) return 0
      const l = s.relLevel * (1 - s.relAge / s.r)
      return l > 0 ? l : 0
    }
    const peak = s.vol
    const sus = Math.max(0, peak - s.s)
    if (s.age < s.a) return (peak * (s.age + 1)) / (s.a + 1)
    const ad = s.age - s.a
    if (s.d > 0 && ad < s.d) return peak - ((peak - sus) * ad) / s.d
    return sus
  }

  private psgUpdateLevel(ch: number, s: PsgState): void {
    const lvl = Math.round(this.psgLevel(s))
    let att = lvl <= 0 ? 15 : Math.min(15, 15 - lvl + s.att)
    if (att < 0) att = 0
    if (att !== s.lastAtt) {
      s.lastAtt = att
      this.psgSetAtt(ch, att)
    }
    if (!s.keyed && lvl <= 0) s.on = false
  }

  private psgRelease(s: PsgState): void {
    if (!s.keyed) return
    s.relLevel = this.psgLevel(s)
    s.keyed = false
    s.relAge = 0
    s.offAt = Infinity
  }

  private noiseOn(ti: number, tr: Track, voiceIdx: number, vel: number, offAt: number): void {
    const kit = this.song.noiseKit
    const v = kit[voiceIdx] ?? kit[0]
    if (!v) return
    const s = this.noise
    s.track = ti
    s.notes = []
    s.age = 0
    s.relAge = 0
    s.vel = vel
    s.offAt = offAt
    s.vol = v.vol
    s.a = v.a
    s.d = v.d
    s.s = v.s
    s.r = v.r
    s.vib = undefined
    s.pitchEnv = undefined
    s.detune = 0
    s.att = volToSteps((tr.vol / 100) * (vel / 15), PSG_STEP_DB)
    s.on = true
    s.keyed = true
    s.lastAtt = -1
    // escribir el registro de ruido reinicia el LFSR (como el chip real)
    const ctl = (v.white ? 4 : 0) | (v.rate & 3)
    this.psgW(0xe0 | ctl)
    this.psgUpdateLevel(3, s)
  }

  // ── DAC (percusión PCM) ───────────────────────────────────────────────────
  private pcmFor(idx: number): Float32Array | null {
    const v = this.song.drumKit[idx]
    if (!v) return null
    const key = `${v.kind}|${v.pitch}|${v.decay}|${v.tone}|${v.gain}|${this.song.dacRate}|${v.pcm ?? ''}|${v.rate ?? ''}`
    let pcm = this.pcmCache.get(key)
    if (!pcm) {
      pcm = renderDrum(v, this.song.dacRate)
      this.pcmCache.set(key, pcm)
      if (this.pcmCache.size > 64) {
        const first = this.pcmCache.keys().next().value
        if (first !== undefined) this.pcmCache.delete(first)
      }
    }
    return pcm
  }

  private dacTrigger(drumIdx: number, vel: number, tr: Track, pan?: Pan): void {
    const pcm = this.pcmFor(drumIdx)
    if (!pcm) return
    if (!this.dacEnabled) {
      this.dacEnabled = true
      this.ymW(0, 0x28, this.fmKeySel(5), true)
      this.fm[5].on = false
      this.fm[5].keyed = false
      this.ymW(0, 0x2b, 0x80)
    }
    // el panorama del canal 6 es el de todo el DAC: un golpe con panorama propio se lleva consigo
    // lo que aún esté sonando (como en la consola)
    this.ymW(1, 0xb4 + 2, this.fmPan(tr, pan) << 6)
    const gain = (vel / 15) * (tr.vol / 100)
    this.onDrum?.(this.t, drumIdx, gain)
    if (this.dacVoices.length >= 4) {
      // se sacrifica la voz a la que menos le queda por sonar: un charles antes que un plato o un timbal
      let k = 0
      for (let i = 1; i < this.dacVoices.length; i++) {
        if (this.dacVoices[i].pcm.length - this.dacVoices[i].pos < this.dacVoices[k].pcm.length - this.dacVoices[k].pos) k = i
      }
      this.dacVoices.splice(k, 1)
    }
    this.dacVoices.push({ pcm, pos: 0, gain })
    if (this.dacVoices.length === 1) this.dacNext = this.t
  }

  private dacTick(): void {
    let mix = 0
    for (let i = this.dacVoices.length - 1; i >= 0; i--) {
      const v = this.dacVoices[i]
      mix += v.pcm[v.pos++] * v.gain
      if (v.pos >= v.pcm.length) this.dacVoices.splice(i, 1)
    }
    const b = Math.max(1, Math.min(255, Math.round(Math.max(-1, Math.min(1, mix)) * 127) + 128))
    if (b !== this.dacLast) {
      this.dacLast = b
      this.ymW(0, 0x2a, b, true)
    }
  }

  // ── frame de 60 Hz ────────────────────────────────────────────────────────
  private frameTick(): void {
    const song = this.song
    for (let c = 0; c < 6; c++) {
      const f = this.fm[c]
      if (!f.on) continue
      const tr = song.tracks[f.track]
      if (!tr || !isTrackAudible(song, f.track)) {
        this.fmKeyOff(c)
        continue
      }
      f.age++
      f.glideAge++
      if (f.keyed) {
        const bank = this.fmPatchFor(tr)
        if (bank !== f.patch) {
          // edición en vivo del instrumento mientras suena
          f.patch = bank
          this.loadFmPatch(c, bank, f.pan, f.att, f.vel)
        }
        this.fmFreq(c, this.fmSemi(f, bank, f.age))
      }
    }
    for (let c = 0; c < 3; c++) {
      const s = this.psg[c]
      if (!s.on) continue
      if (!isTrackAudible(song, s.track)) {
        s.on = false
        s.keyed = false
        this.psgSetAtt(c, 15)
        s.lastAtt = 15
        continue
      }
      if (s.keyed) {
        s.age++
        s.glideAge++
        this.psgUpdatePitch(c, s)
      } else s.relAge++
      this.psgUpdateLevel(c, s)
    }
    const n = this.noise
    if (n.on) {
      if (!isTrackAudible(song, n.track)) {
        n.on = false
        n.keyed = false
        this.psgSetAtt(3, 15)
        n.lastAtt = 15
      } else {
        if (n.keyed) n.age++
        else n.relAge++
        this.psgUpdateLevel(3, n)
      }
    }
  }

  // ── notas en directo ──────────────────────────────────────────────────────
  /** Dispara una nota en la pista `ti` (tecla del teclado, clic en el piano roll...). */
  liveOn(ti: number, note: number, vel = 12): void {
    const tr = this.song.tracks[ti]
    if (!tr) return
    if (tr.kind === 'dac') {
      this.dacTrigger(note, vel, tr)
      return
    }
    if (tr.kind === 'noise') {
      this.noiseOn(ti, tr, note, vel, Infinity)
      return
    }
    const hold = this.live.get(ti) ?? { notes: [], vel }
    if (!hold.notes.includes(note)) hold.notes.push(note)
    hold.vel = vel
    this.live.set(ti, hold)
    const semis = [...hold.notes].map((n) => n + tr.transpose).sort((a, b) => a - b)
    if (tr.kind === 'fm') {
      const f = this.fm[tr.ch]
      if (hold.notes.length > 1 && f.keyed && f.track === ti) {
        f.notes = semis // acorde: se arpegia sin re-disparar
      } else this.fmNoteOn(ti, tr, semis, vel, Infinity)
    } else {
      const s = this.psg[tr.ch]
      if (hold.notes.length > 1 && s.keyed && s.track === ti) s.notes = semis
      else this.psgNoteOn(ti, tr, semis, vel, Infinity)
    }
  }

  liveOff(ti: number, note: number): void {
    const tr = this.song.tracks[ti]
    if (!tr) return
    if (tr.kind === 'noise') {
      this.psgRelease(this.noise)
      return
    }
    if (tr.kind === 'dac') return
    const hold = this.live.get(ti)
    if (!hold) return
    hold.notes = hold.notes.filter((n) => n !== note)
    if (hold.notes.length === 0) {
      this.live.delete(ti)
      if (tr.kind === 'fm') this.fmKeyOff(tr.ch)
      else this.psgRelease(this.psg[tr.ch])
    } else {
      const semis = hold.notes.map((n) => n + tr.transpose).sort((a, b) => a - b)
      if (tr.kind === 'fm') this.fm[tr.ch].notes = semis
      else this.psg[tr.ch].notes = semis
    }
  }

  /** Nota corta de previsualización (clic en el piano roll). */
  preview(ti: number, note: number, vel = 12, seconds = 0.25): void {
    const tr = this.song.tracks[ti]
    if (!tr) return
    if (tr.kind === 'dac') {
      this.dacTrigger(note, vel, tr)
      return
    }
    const off = this.t + seconds * this.sampleRate
    if (tr.kind === 'noise') this.noiseOn(ti, tr, note, vel, off)
    else if (tr.kind === 'fm') this.fmNoteOn(ti, tr, [note + tr.transpose], vel, off)
    else this.psgNoteOn(ti, tr, [note + tr.transpose], vel, off)
  }

  // ── medidores ─────────────────────────────────────────────────────────────
  /** nivel 0-1 de cada pista (en el orden de song.tracks) */
  meters(out: Float32Array): void {
    const tracks = this.song.tracks
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i]
      let v = 0
      if (tr.kind === 'fm') v = Math.abs(this.con.ym.chanOut[tr.ch]) / 6000
      else if (tr.kind === 'dac') v = this.dacVoices.length ? 0.9 : Math.abs(this.con.ym.chanOut[5]) / 6000
      else if (tr.kind === 'psg') v = this.con.psg.chanLevel[tr.ch] * 1.5
      else v = this.con.psg.chanLevel[3] * 1.5
      out[i] = v > 1 ? 1 : v
    }
  }

  /** ¿suena algo? (para detectar el final de una cola de render) */
  isSilent(): boolean {
    for (const f of this.fm) if (f.on) return false
    for (const p of this.psg) if (p.on) return false
    return !this.noise.on && this.dacVoices.length === 0
  }
}

// ── utilidades ──────────────────────────────────────────────────────────────
/** desviación de tono en cents por vibrato + envolvente de pitch, a `age` frames */
export function pitchOffset(vib: Vibrato | undefined, env: PitchEnv | undefined, age: number): number {
  let cents = 0
  if (vib && age >= vib.delay) {
    const t = (age - vib.delay) / FRAME_HZ
    cents += vib.depth * Math.sin(2 * Math.PI * vib.rate * t)
  }
  if (env && env.semis !== 0) {
    cents += env.semis * 100 * Math.exp((-3 * age) / Math.max(1, env.frames))
  }
  return cents
}
