// ── Cliente de audio (hilo principal): contexto, worklet, analizador ─────────
import type { SoundModel } from '../core/mixer'
import type { Song } from '../music/song'
import type { FromWorklet, Position, ToWorklet } from './protocol'
import { WORKLET_NAME } from './protocol'
import workletUrl from './worklet.ts?worker&url'

export interface EngineStatus {
  playing: boolean
  pos: Position
  meters: number[]
  loops: number
  /** lo que el worklet cree tener: sirve para comprobar la sincronía */
  bpm: number
  noteCount: number
}

type StatusListener = (s: EngineStatus) => void
type LiveListener = (m: Extract<FromWorklet, { type: 'live' }>) => void

class AudioEngine {
  ctx: AudioContext | null = null
  analyser: AnalyserNode | null = null
  private node: AudioWorkletNode | null = null
  private master: GainNode | null = null
  private starting: Promise<void> | null = null
  private pendingSong: Song | null = null
  private model: SoundModel = 'md1'
  private raf = 0
  private statusListeners = new Set<StatusListener>()
  private liveListeners = new Set<LiveListener>()
  private stopListeners = new Set<() => void>()
  /** último estado conocido */
  status: EngineStatus = { playing: false, pos: { order: 0, step: 0, frac: 0 }, meters: [], loops: 0, bpm: 0, noteCount: 0 }
  /** última canción enviada al worklet (para mandar solo diferencias) */
  private sent: Song | null = null

  get ready(): boolean {
    return this.node !== null
  }

  /** Crea el contexto y carga el worklet. Debe llamarse desde un gesto del usuario. */
  start(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      await ctx.audioWorklet.addModule(workletUrl)
      const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      })
      const master = ctx.createGain()
      master.gain.value = 0.9
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.6
      node.connect(master)
      master.connect(analyser)
      analyser.connect(ctx.destination)
      node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.onMessage(e.data)
      this.ctx = ctx
      this.node = node
      this.master = master
      this.analyser = analyser
      this.post({ type: 'config', model: this.model })
      if (this.pendingSong) this.sendSong(this.pendingSong)
      this.pendingSong = null
    })()
    return this.starting
  }

  async resume(): Promise<void> {
    await this.start()
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume()
  }

  private onMessage(m: FromWorklet): void {
    switch (m.type) {
      case 'status':
        this.status = { playing: m.playing, pos: m.pos, meters: m.meters, loops: m.loops, bpm: m.bpm, noteCount: m.noteCount }
        this.statusListeners.forEach((f) => f(this.status))
        break
      case 'stopped':
        this.status = { ...this.status, playing: false }
        this.stopListeners.forEach((f) => f())
        this.statusListeners.forEach((f) => f(this.status))
        break
      case 'live':
        this.liveListeners.forEach((f) => f(m))
        break
      default:
        break
    }
  }

  private post(m: ToWorklet): void {
    this.node?.port.postMessage(m)
  }

  /** sincroniza la canción (agrupado por fotograma para no saturar el puerto) */
  setSong(song: Song): void {
    if (!this.node) {
      this.pendingSong = song
      return
    }
    this.pendingSong = song
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      if (this.pendingSong) {
        this.sendSong(this.pendingSong)
        this.pendingSong = null
      }
    })
  }

  /** envía de inmediato la canción pendiente (antes de reproducir) */
  flush(): void {
    if (this.node && this.pendingSong) {
      this.sendSong(this.pendingSong)
      this.pendingSong = null
    }
  }

  /** manda la canción completa la primera vez y después solo las propiedades que cambiaron */
  private sendSong(song: Song): void {
    const prev = this.sent
    this.sent = song
    if (!prev) {
      this.post({ type: 'song', song })
      return
    }
    const delta: Record<string, unknown> = {}
    let any = false
    for (const k of Object.keys(song) as (keyof Song)[]) {
      if (song[k] !== prev[k]) {
        delta[k] = song[k]
        any = true
      }
    }
    if (any) this.post({ type: 'songDelta', delta: delta as Partial<Song> })
  }

  /** se incrementa con cada play/stop: un play() que espera al audio se cancela si llega un stop() */
  private gen = 0

  async play(order = 0, step = 0, preroll = 0): Promise<boolean> {
    const g = ++this.gen
    await this.resume()
    if (g !== this.gen) return false
    this.flush()
    this.post({ type: 'play', order, step, preroll })
    this.status = { ...this.status, playing: true }
    return true
  }

  stop(): void {
    this.gen++
    this.post({ type: 'stop' })
    this.status = { ...this.status, playing: false }
  }

  panic(): void {
    this.post({ type: 'panic' })
  }

  async liveOn(track: number, note: number, vel = 12): Promise<void> {
    await this.resume()
    this.flush()
    this.post({ type: 'liveOn', track, note, vel })
  }

  liveOff(track: number, note: number): void {
    this.post({ type: 'liveOff', track, note })
  }

  async preview(track: number, note: number, vel = 12): Promise<void> {
    await this.resume()
    this.flush()
    this.post({ type: 'preview', track, note, vel })
  }

  setMetronome(on: boolean): void {
    this.post({ type: 'config', metronome: on })
  }

  /** carácter de sonido de la consola (se recuerda si el audio aún no ha arrancado) */
  setModel(model: SoundModel): void {
    this.model = model
    this.post({ type: 'config', model })
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1.2, v))
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }
  onLive(fn: LiveListener): () => void {
    this.liveListeners.add(fn)
    return () => this.liveListeners.delete(fn)
  }
  onStop(fn: () => void): () => void {
    this.stopListeners.add(fn)
    return () => this.stopListeners.delete(fn)
  }
}

export const engine = new AudioEngine()
