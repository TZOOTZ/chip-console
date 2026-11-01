/// <reference types="audioworklet" />
// ── AudioWorkletProcessor: el sound driver y los chips corren en el hilo de audio
import { createEmptySong } from '../music/presets'
import type { FromWorklet, ToWorklet } from './protocol'
import { WORKLET_NAME } from './protocol'
import { Synth } from './synth'

function countNotes(song: { patterns: { notes: Record<string, unknown[]> }[] }): number {
  let n = 0
  for (const p of song.patterns) for (const k of Object.keys(p.notes)) n += p.notes[k].length
  return n
}

class ChipProcessor extends AudioWorkletProcessor {
  private synth: Synth
  private blocks = 0
  private readonly meters: Float32Array

  constructor() {
    super()
    this.synth = new Synth(sampleRate, createEmptySong())
    this.meters = new Float32Array(16)
    this.synth.onStop = () => this.post({ type: 'stopped' })
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.onMessage(e.data)
    this.post({ type: 'ready', sampleRate })
  }

  private post(m: FromWorklet): void {
    this.port.postMessage(m)
  }

  private onMessage(m: ToWorklet): void {
    const s = this.synth
    switch (m.type) {
      case 'song':
        s.setSong(m.song)
        break
      case 'songDelta':
        s.setSong({ ...s.song, ...m.delta })
        break
      case 'play':
        s.play(m.order, m.step, m.preroll ?? 0)
        break
      case 'config':
        if (m.metronome !== undefined) s.metronome = m.metronome
        if (m.model !== undefined) s.setModel(m.model)
        break
      case 'stop':
        s.stop()
        break
      case 'panic':
        s.panic()
        break
      case 'liveOn':
        s.liveOn(m.track, m.note, m.vel)
        this.post({ type: 'live', on: true, track: m.track, note: m.note, vel: m.vel, playing: s.playing, pos: s.position() })
        break
      case 'liveOff':
        s.liveOff(m.track, m.note)
        this.post({ type: 'live', on: false, track: m.track, note: m.note, vel: 0, playing: s.playing, pos: s.position() })
        break
      case 'preview':
        s.preview(m.track, m.note, m.vel)
        break
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (!out || out.length === 0) return true
    const l = out[0]
    const r = out.length > 1 ? out[1] : out[0]
    this.synth.render(l, r, l.length)
    // estado a ~30 Hz (cada 12 bloques de 128 muestras a 48 kHz)
    if (++this.blocks % 12 === 0) {
      this.synth.meters(this.meters)
      this.post({
        type: 'status',
        playing: this.synth.playing,
        pos: this.synth.position(),
        meters: Array.from(this.meters.subarray(0, this.synth.song.tracks.length)),
        loops: this.synth.loops,
        bpm: this.synth.song.bpm,
        noteCount: countNotes(this.synth.song),
      })
    }
    return true
  }
}

registerProcessor(WORKLET_NAME, ChipProcessor)
