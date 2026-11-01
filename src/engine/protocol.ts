// ── Protocolo de mensajes UI ⇄ AudioWorklet ─────────────────────────────────
import type { SoundModel } from '../core/mixer'
import type { Song } from '../music/song'

export type ToWorklet =
  | { type: 'song'; song: Song }
  /** solo las propiedades de primer nivel que cambiaron */
  | { type: 'songDelta'; delta: Partial<Song> }
  | { type: 'play'; order: number; step: number; preroll?: number }
  | { type: 'config'; metronome?: boolean; model?: SoundModel }
  | { type: 'stop' }
  | { type: 'panic' }
  | { type: 'liveOn'; track: number; note: number; vel: number }
  | { type: 'liveOff'; track: number; note: number }
  | { type: 'preview'; track: number; note: number; vel: number }

export interface Position {
  order: number
  step: number
  frac: number
}

export type FromWorklet =
  | { type: 'ready'; sampleRate: number }
  | { type: 'status'; playing: boolean; pos: Position; meters: number[]; loops: number; bpm: number; noteCount: number }
  | { type: 'stopped' }
  /** nota en directo con la posición exacta del secuenciador (para grabar) */
  | { type: 'live'; on: boolean; track: number; note: number; vel: number; playing: boolean; pos: Position }

export const WORKLET_NAME = 'tz-chip-synth'
