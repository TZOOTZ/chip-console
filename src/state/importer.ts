// ── Abrir un archivo en la app (botón IMPORTAR o arrastrarlo a la ventana) ───────────
import type { ImportReport } from '../import/midi'
import { useApp } from './store'

export interface ShownReport extends ImportReport {
  kind: string
}

/** Lee el archivo, lo reconoce (proyecto, MIDI o VGM/VGZ) y lo carga en la app; el importador se descarga solo al usarlo. */
export async function importFileToApp(file: File): Promise<void> {
  const s = useApp.getState()
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { importSong } = await import('../import')
    const r = importSong(bytes, file.name)
    s.replaceSong(r.song, { keepHistory: true })
    if (r.report) {
      useApp.getState().set({ importReport: { ...r.report, kind: r.kind } })
      s.notify(`${r.kind} «${r.song.title}»: ${r.report.notes} notas en ${r.report.tracks} pistas`)
    } else s.notify(`Proyecto «${r.song.title}» importado`)
  } catch (e) {
    s.notify(`No se pudo importar: ${e instanceof Error ? e.message : 'archivo no válido'}`)
  }
}
