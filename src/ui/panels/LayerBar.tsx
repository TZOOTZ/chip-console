// ── Capas: el tema recién generado entra pista a pista ──────────────────────
import { layerState, revealAll, revealNext } from '../../music/capas'
import { useApp } from '../../state/store'
import { cx } from '../util'

/** fila con el interruptor POR CAPAS y, si hay pistas en espera, el botón que suma la siguiente */
export function LayerBar() {
  const song = useApp((s) => s.song)
  const layered = useApp((s) => s.layered)
  const set = useApp((s) => s.set)
  const edit = useApp((s) => s.edit)
  const notify = useApp((s) => s.notify)
  const st = layerState(song)
  const next = st.next !== null ? song.tracks[st.next] : null

  return (
    <div className="row">
      <button
        className={cx('btn sm', layered && 'on')}
        aria-pressed={layered}
        onClick={() => set({ layered: !layered })}
        title="Al generar, suenan primero batería, bajo, tema y la armonía principal; el resto espera en mute y entra con SIGUIENTE"
      >
        POR CAPAS
      </button>
      {next ? (
        <>
          <span className="label">
            SUENAN {st.sounding}/{st.total}
          </span>
          <button
            className="btn sm primary grow"
            title="Quita el mute a la siguiente pista en espera (Ctrl+Z la vuelve a callar)"
            onClick={() => {
              edit((d) => {
                revealNext(d)
              })
              notify(`Entra ${next.name} · ${st.sounding + 1} de ${st.total} pistas`)
            }}
          >
            + SIGUIENTE: {next.name}
          </button>
          <button
            className="btn sm"
            title="Que suenen todas las pistas con notas"
            onClick={() => {
              edit((d) => revealAll(d))
              notify(`Suenan las ${st.total} pistas`)
            }}
          >
            TODAS
          </button>
        </>
      ) : (
        <span className="label">{st.total ? `SUENAN LAS ${st.total} PISTAS` : ''}</span>
      )}
    </div>
  )
}
