// ── Diálogo de exportación (WAV, stems, MIDI, VGM, VGZ, XGM, ROM, proyecto) ───────
import { unzipSync } from 'fflate'
import { useMemo, useState } from 'react'
import { SCOPE_KINDS, exportParts, partFileName, slug, type ExportScope } from '../export/escopo'
import { downloadBytes, runExport } from '../export/runner'
import { zipFiles } from '../export/share'
import type { WavFormat } from '../export/wav'
import type { Song } from '../music/song'
import { useApp } from '../state/store'
import { Modal, Segmented } from './controls'
import { Icon } from './icons'
import { RomBudget } from './RomBudget'
import { cx } from './util'

type Kind = 'wav' | 'stems' | 'midi' | 'vgm' | 'vgz' | 'xgm' | 'rom' | 'project'

const KINDS: { value: Kind; label: string; desc: string }[] = [
  { value: 'wav', label: 'WAV', desc: 'Mezcla estéreo para tu DAW (render offline exacto del chip, con el carácter de sonido elegido en ⚙).' },
  { value: 'stems', label: 'STEMS', desc: 'Un WAV por canal en un ZIP (bajo, teclas, batería…), todos alineados.' },
  { value: 'midi', label: 'MIDI', desc: 'SMF tipo 1: una pista por canal, batería en el canal 10.' },
  { value: 'vgm', label: 'VGM', desc: 'Registro de las escrituras al YM2612 y al SN76489, con bucle y GD3: lo mismo que suena en la app, para cualquier reproductor VGM.' },
  { value: 'vgz', label: 'VGZ', desc: 'VGM comprimido (gzip). Ideal para SGDK/xgmtool.' },
  { value: 'xgm', label: 'XGM', desc: 'Formato del driver XGM de SGDK (un frame por retrazo, batería como PCM de 8 bit a 14 kHz). Listo para el sistema de recursos de SGDK.' },
  { value: 'rom', label: 'ROM', desc: 'ROM de Mega Drive (.bin) que arranca sola y toca el tema con el driver XGM: para un emulador o para la consola con un cartucho flash. START pausa; A, B o C vuelven al principio.' },
  { value: 'project', label: 'PROYECTO', desc: 'JSON editable con todo (instrumentos, patrones, orden).' },
]

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const song = useApp((s) => s.song)
  const model = useApp((s) => s.sound)
  const notify = useApp((s) => s.notify)
  const selPattern = useApp((s) => s.selPattern)
  const [scope, setScope] = useState<ExportScope>('song')
  const [kind, setKind] = useState<Kind>('wav')
  const [format, setFormat] = useState<WavFormat>('pcm16')
  const [loops, setLoops] = useState(1)
  const [normalize, setNormalize] = useState(true)
  const [straight, setStraight] = useState(false)
  const [rate, setRate] = useState(44100)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const isAudio = kind === 'wav' || kind === 'stems'
  const parts = useMemo(() => exportParts(song, scope, selPattern), [song, scope, selPattern])
  const patName = song.patterns.find((p) => p.id === selPattern)?.name ?? song.patterns[0].name
  // un patrón suelto se repite: siempre hay vueltas que elegir
  const hasLoop = scope === 'song' ? song.loopStart >= 0 : true

  const pickKind = (k: Kind) => {
    setKind(k)
    if (!SCOPE_KINDS[scope].includes(k)) setScope('pattern')
  }

  const run = async () => {
    setBusy(true)
    setProgress(0)
    try {
      const jobFor = (sg: Song) =>
        kind === 'wav'
          ? ({ kind, song: sg, format, loops: hasLoop ? loops : 1, normalize, sampleRate: rate, model } as const)
          : kind === 'stems'
            ? ({ kind, song: sg, format, loops: hasLoop ? loops : 1, sampleRate: rate, model } as const)
            : kind === 'midi'
              ? ({ kind, song: sg, straight } as const)
              : ({ kind, song: sg } as const)
      const ext = (name: string): string => name.slice(name.lastIndexOf('.'))
      let out: { name: string; mime: string; bytes: Uint8Array }
      if (parts.length === 1) {
        const r = await runExport(jobFor(parts[0].song), setProgress)
        out = scope === 'song' ? r : { ...r, name: partFileName(song.title, parts[0].label, 0, 1, ext(r.name)) }
      } else {
        // varios patrones: un archivo por patrón (o una carpeta de stems por patrón) en un ZIP
        const files: Record<string, Uint8Array> = {}
        for (let i = 0; i < parts.length; i++) {
          const r = await runExport(jobFor(parts[i].song), (v) => setProgress((i + v) / parts.length))
          if (kind === 'stems') {
            const dir = partFileName(song.title, parts[i].label, i, parts.length, '')
            for (const [fn, b] of Object.entries(unzipSync(r.bytes))) files[`${dir}/${fn}`] = b
          } else files[partFileName(song.title, parts[i].label, i, parts.length, ext(r.name))] = r.bytes
        }
        out = { name: `${slug(song.title)}_patrones.zip`, mime: 'application/zip', bytes: zipFiles(files) }
      }
      downloadBytes(out.bytes, out.name, out.mime)
      notify(`${out.name} · ${(out.bytes.length / 1024).toFixed(0)} KB`)
      onClose()
    } catch (e) {
      notify(`Error al exportar: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="EXPORTAR" width={560}>
      <div className="flex flex-col gap-3">
        <div className="row" role="radiogroup" aria-label="Formato de exportación">
          {KINDS.map((k) => (
            <button key={k.value} role="radio" aria-checked={kind === k.value} className={cx('btn', kind === k.value && 'sel')} onClick={() => pickKind(k.value)} disabled={busy}>
              {k.label}
            </button>
          ))}
        </div>
        <p className="modal-p" style={{ minHeight: '2.2em' }}>
          {KINDS.find((k) => k.value === kind)?.desc}
        </p>
        <div className="form">
          <span className="label">QUÉ EXPORTAR</span>
          <div className="row" role="radiogroup" aria-label="Qué exportar">
            {([['song', 'CANCIÓN', 'El orden entero, como suena'], ['pattern', `PATRÓN ${patName}`, 'Solo el patrón seleccionado, repetido'], ['patterns', 'CADA PATRÓN', 'Un archivo por patrón con notas, en un ZIP']] as const).map(([v, label, title]) => (
              <button key={v} role="radio" aria-checked={scope === v} className={cx('btn', scope === v && 'sel')} title={title} disabled={busy || !SCOPE_KINDS[v].includes(kind)} onClick={() => setScope(v)}>
                {label}
              </button>
            ))}
          </div>
          <p className="hint" style={{ gridColumn: '1 / -1' }}>
            MUTE y SOLO cuentan en todos los formatos: sale lo que oyes.
          </p>
          {scope !== 'song' && (
            <p className="hint" style={{ gridColumn: '1 / -1' }}>
              {scope === 'pattern' ? `Solo el patrón ${patName}, en bucle.` : `${parts.length} archivos (los patrones con notas), uno por patrón, en un ZIP.`}
            </p>
          )}
        </div>
        {open && (kind === 'xgm' || kind === 'rom') && scope !== 'patterns' && <RomBudget song={parts[0].song} />}
        {kind === 'midi' && song.swing > 0 && (
          <div className="form">
            <span className="label">SWING</span>
            <div className="row">
              <Segmented
                large
                value={straight ? 1 : 0}
                onChange={(v) => setStraight(v === 1)}
                disabled={busy}
                options={[
                  { value: 0, label: 'INCLUIDO', title: 'Las notas llevan el swing de la canción: suena en tu DAW como en la app' },
                  { value: 1, label: 'RECTO', title: 'Las notas van en la rejilla; aplica tú el groove en el DAW' },
                ]}
              />
            </div>
          </div>
        )}
        {isAudio && (
          <div className="form">
            <span className="label">FORMATO</span>
            <div className="row">
              <Segmented
                large
                value={format}
                onChange={setFormat}
                disabled={busy}
                options={[
                  { value: 'pcm16', label: '16 bit' },
                  { value: 'pcm24', label: '24 bit' },
                  { value: 'float32', label: '32 float' },
                ]}
              />
              <Segmented
                large
                value={rate}
                onChange={setRate}
                disabled={busy}
                options={[
                  { value: 44100, label: '44.1 kHz' },
                  { value: 48000, label: '48 kHz' },
                ]}
              />
            </div>
            <span className="label">VUELTAS</span>
            <div className="row">
              <Segmented large value={hasLoop ? loops : 1} onChange={setLoops} disabled={busy || !hasLoop} options={[1, 2, 3, 4].map((v) => ({ value: v, label: String(v) }))} />
              {!hasLoop && <span className="hint">la canción no tiene bucle</span>}
              {kind === 'wav' && (
                <button className={cx('btn', normalize && 'on')} onClick={() => setNormalize(!normalize)} disabled={busy} aria-pressed={normalize}>
                  NORMALIZAR −1 dB
                </button>
              )}
            </div>
          </div>
        )}
        {busy && (
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn lg" onClick={onClose} disabled={busy}>
            CANCELAR
          </button>
          <button className="btn lg primary" onClick={() => void run()} disabled={busy}>
            {Icon.export} {busy ? `RENDERIZANDO ${Math.round(progress * 100)}%` : 'EXPORTAR'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
