/// <reference lib="webworker" />
// ── Worker de exportación: renderiza fuera del hilo de la UI ─────────────────
import type { SoundModel } from '../core/mixer'
import type { Song } from '../music/song'
import { slug } from './escopo'
import { auditarPresupuesto, reglas, type Presupuesto, type Regla } from './presupuesto'
import { buildMidi } from './midi'
import { normalize, renderSong, renderStems, type RenderedAudio } from './render'
import { buildRom } from './rom'
import { songToProjectFile, zipFiles } from './share'
import { buildVgm, buildVgz } from './vgm'
import { buildXgm } from './xgm'
import { encodeWav, type WavFormat } from './wav'
// la ROM reproductora (rom/player, compilada con SGDK): viaja como un archivo más de la app
import playerUrl from '../../rom/player.bin?url'

export type ExportJob =
  | { kind: 'wav'; song: Song; format: WavFormat; loops: number; normalize: boolean; sampleRate: number; model: SoundModel }
  | { kind: 'stems'; song: Song; format: WavFormat; loops: number; sampleRate: number; model: SoundModel }
  | { kind: 'midi'; song: Song; straight?: boolean }
  | { kind: 'vgm'; song: Song }
  | { kind: 'vgz'; song: Song }
  | { kind: 'xgm'; song: Song }
  | { kind: 'rom'; song: Song }
  | { kind: 'project'; song: Song }
  | { kind: 'audit'; song: Song }

export type WorkerIn = { id: number; job: ExportJob }
export type WorkerOut =
  | { id: number; type: 'progress'; value: number }
  | { id: number; type: 'done'; name: string; mime: string; bytes: Uint8Array }
  | { id: number; type: 'audit'; presupuesto: Presupuesto; reglas: Regla[] }
  | { id: number; type: 'error'; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

let player: Promise<Uint8Array> | null = null
/** descarga (una vez) la ROM reproductora; con la app instalada sale de la caché y funciona sin red */
function loadPlayer(): Promise<Uint8Array> {
  player ??= fetch(playerUrl).then(async (res) => {
    if (!res.ok) throw new Error('No se ha podido cargar la ROM reproductora')
    return new Uint8Array(await res.arrayBuffer())
  })
  player.catch(() => (player = null))
  return player
}

ctx.onmessage = (e: MessageEvent<WorkerIn>) => void run(e.data)

async function run({ id, job }: WorkerIn): Promise<void> {
  const post = (m: WorkerOut, transfer: Transferable[] = []) => ctx.postMessage(m, transfer)
  try {
    const base = slug(job.song.title)
    const progress = (v: number) => post({ id, type: 'progress', value: v })
    let name = ''
    let mime = 'application/octet-stream'
    let bytes: Uint8Array
    switch (job.kind) {
      case 'audit': {
        // el presupuesto de ROM del tema (no genera ningún archivo)
        const presupuesto = auditarPresupuesto(job.song)
        post({ id, type: 'audit', presupuesto, reglas: reglas(presupuesto) })
        return
      }
      case 'wav': {
        const a: RenderedAudio = renderSong(job.song, { sampleRate: job.sampleRate, loops: job.loops, tail: 3, model: job.model, onProgress: progress })
        if (job.normalize) normalize(a, -1)
        bytes = encodeWav(a, job.format)
        name = `${base}.wav`
        mime = 'audio/wav'
        break
      }
      case 'stems': {
        const stems = renderStems(job.song, { sampleRate: job.sampleRate, loops: job.loops, tail: 3, model: job.model, onProgress: progress })
        // normaliza todos con la misma ganancia para conservar el balance
        let pk = 0
        for (const [, a] of stems) for (let i = 0; i < a.left.length; i++) pk = Math.max(pk, Math.abs(a.left[i]), Math.abs(a.right[i]))
        const g = pk > 1 ? 1 / pk : 1
        const files: Record<string, Uint8Array> = {}
        for (const [tid, a] of stems) {
          if (g !== 1) {
            for (let i = 0; i < a.left.length; i++) {
              a.left[i] *= g
              a.right[i] *= g
            }
          }
          const tr = job.song.tracks.find((t) => t.id === tid)
          files[`${base}_${tid.toUpperCase()}_${slug(tr?.name ?? tid)}.wav`] = encodeWav(a, job.format)
        }
        bytes = zipFiles(files)
        name = `${base}_stems.zip`
        mime = 'application/zip'
        break
      }
      case 'midi':
        bytes = buildMidi(job.song, { straight: job.straight })
        name = `${base}.mid`
        mime = 'audio/midi'
        break
      case 'vgm':
        bytes = buildVgm(job.song)
        name = `${base}.vgm`
        break
      case 'vgz':
        bytes = buildVgz(job.song)
        name = `${base}.vgz`
        break
      case 'xgm':
        bytes = buildXgm(job.song)
        name = `${base}.xgm`
        break
      case 'rom':
        bytes = buildRom(job.song, await loadPlayer()).rom
        name = `${base}.bin`
        break
      case 'project':
        bytes = new TextEncoder().encode(songToProjectFile(job.song))
        name = `${base}.tzmd.json`
        mime = 'application/json'
        break
    }
    post({ id, type: 'done', name, mime, bytes }, [bytes.buffer as ArrayBuffer])
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
