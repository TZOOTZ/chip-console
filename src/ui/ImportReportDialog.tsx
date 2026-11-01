// ── Informe de una importación de MIDI o VGM: qué ha entrado y qué se ha perdido ───
import { useApp } from '../state/store'
import { Modal } from './controls'

export function ImportReportDialog() {
  const report = useApp((s) => s.importReport)
  const set = useApp((s) => s.set)
  const close = () => set({ importReport: null })
  // al cerrarse el diálogo llega un evento de cierre tardío: no ha de borrar el informe de una importación posterior
  const closed = () => {
    if (useApp.getState().importReport === report) close()
  }
  return (
    <Modal open={report !== null} onClose={closed} title={`IMPORTADO · ${report?.kind ?? ''}`} width={560}>
      {report && (
        <div className="flex flex-col gap-3">
          <p className="modal-p">
            <b>{report.title}</b> · {report.notes} notas en {report.tracks} pistas
            {report.dropped > 0 ? ` · ${report.dropped} notas no caben y se han descartado` : ''}
          </p>
          {report.info && report.info.length > 0 && (
            <ul className="audit-list">
              {report.info.map((t) => (
                <li key={t} className="ok">
                  <span aria-hidden>i</span>
                  <b>{t}</b>
                </li>
              ))}
            </ul>
          )}
          {report.warnings.length > 0 ? (
            <ul className="audit-list">
              {report.warnings.map((t) => (
                <li key={t} className="bad">
                  <span aria-hidden>!</span>
                  <b>{t}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Sin avisos: todo cabía en la consola.</p>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn lg primary" onClick={close}>
              ENTENDIDO
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
