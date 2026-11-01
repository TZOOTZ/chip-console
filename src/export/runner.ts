// ── Lanza trabajos de exportación en el Worker y descarga el resultado ───────
import type { Song } from '../music/song'
import type { Presupuesto, Regla } from './presupuesto'
import type { ExportJob, WorkerIn, WorkerOut } from './worker'

let worker: Worker | null = null
let nextId = 1

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  return worker
}

export interface ExportResult {
  name: string
  mime: string
  bytes: Uint8Array
}

export interface AuditResult {
  presupuesto: Presupuesto
  reglas: Regla[]
}

/** mide en el worker lo que cuesta el tema en un cartucho y cómo cumple las reglas de ahorro */
export function runAudit(song: Song): Promise<AuditResult> {
  const w = getWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.id !== id) return
      if (m.type === 'progress') return
      w.removeEventListener('message', handler)
      if (m.type === 'audit') resolve({ presupuesto: m.presupuesto, reglas: m.reglas })
      else if (m.type === 'error') reject(new Error(m.message))
      else reject(new Error('respuesta inesperada del worker'))
    }
    w.addEventListener('message', handler)
    const msg: WorkerIn = { id, job: { kind: 'audit', song } }
    w.postMessage(msg)
  })
}

export function runExport(job: ExportJob, onProgress?: (v: number) => void): Promise<ExportResult> {
  const w = getWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.id !== id) return
      if (m.type === 'progress') onProgress?.(m.value)
      else {
        w.removeEventListener('message', handler)
        if (m.type === 'done') resolve({ name: m.name, mime: m.mime, bytes: m.bytes })
        else reject(new Error(m.type === 'error' ? m.message : 'respuesta inesperada del worker'))
      }
    }
    w.addEventListener('message', handler)
    const msg: WorkerIn = { id, job }
    w.postMessage(msg)
  })
}

export function downloadBytes(bytes: Uint8Array, name: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
