// ── Presupuesto de ROM en el diálogo de exportar (XGM y ROM) ──────────────────
// Lo que cuesta el tema en un cartucho y cómo cumple las reglas de ahorro. Se mide en el worker
// con las escrituras reales del driver y el XGC compilado (ver export/presupuesto.ts).
import { useEffect, useState } from 'react'
import { runAudit, type AuditResult } from '../export/runner'
import type { Song } from '../music/song'
import { cx } from './util'

const kb = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export function RomBudget({ song }: { song: Song }) {
  // el resultado lleva la canción que midió: si la canción cambia, hasta que llegue el nuevo se muestra «midiendo»
  const [state, setState] = useState<{ song: Song; res?: AuditResult; err?: string } | null>(null)

  useEffect(() => {
    let live = true
    runAudit(song)
      .then((res) => live && setState({ song, res }))
      .catch((e: unknown) => live && setState({ song, err: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [song])

  const cur = state && state.song === song ? state : null
  if (cur?.err) return <p className="hint">No se ha podido medir el presupuesto: {cur.err}</p>
  const res = cur?.res
  if (!res) return <p className="hint">Midiendo el presupuesto de ROM…</p>
  const { presupuesto: p, reglas } = res
  const ok = reglas.filter((r) => r.ok).length
  const ahorro = p.bytesMusica > 0 ? Math.round((1 - p.bytesMusicaLz / p.bytesMusica) * 100) : 0
  return (
    <div className="audit" role="group" aria-label="Presupuesto de ROM">
      <div className="audit-h">
        <span className="label">PRESUPUESTO DE ROM</span>
        <span className={cx('audit-badge', ok === reglas.length ? 'ok' : 'bad')}>
          {ok}/{reglas.length} reglas
        </span>
      </div>
      <p className="hint">
        Música <b>{kb(p.bytesMusica)}</b> ({kb(p.bytesMusicaLz)} comprimida: repetir exacto ahorra el {ahorro} %) · muestras <b>{kb(p.bytesMuestras)}</b> · total <b>{kb(p.bytesXgc)}</b> · dura <b>{mmss(p.segundos)}</b>
        {p.bucle ? ` · bucle ${mmss(p.segundosBucle)}` : ' · sin bucle'}
      </p>
      <ul className="audit-list">
        {reglas.map((r) => (
          <li key={r.n} className={r.ok ? 'ok' : 'bad'}>
            <span aria-hidden>{r.ok ? '✓' : '✗'}</span>
            <b>
              {r.n} · {r.nombre}
            </b>
            <small>{r.detalle}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
