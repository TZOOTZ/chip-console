// ── Ayuda rápida integrada ───────────────────────────────────────────────────
import { Modal } from './controls'
import { Logo } from './Logo'

const STEPS: [string, string][] = [
  ['1 · Genera o empieza de cero', 'Panel COMPONER → elige estilo (COSMIC DISCO, TECHNO MINIMAL, DARK, JAZZ FUSION, JAZZ SWING, ERA…) y tónica → GENERAR TEMA. O pulsa NUEVO en la cabecera: un tema en blanco con el tempo, el tono y los sonidos que elijas. También puedes arrastrar un .mid, .vgm o .vgz sobre la ventana (o CANCIÓN → IMPORTAR…): sale un informe de lo que ha entrado.'],
  ['2 · Escucha', 'Espacio reproduce desde el patrón seleccionado; Enter desde el principio. REPETIR PATRÓN (tecla C, o el botón de bucle del transporte) repite en bucle solo el patrón seleccionado, sin pasar al siguiente.'],
  ['3 · Edita', 'Clic en el piano roll crea una nota; arrastra para alargar o mover; clic derecho o Alt+clic borra; Shift+arrastrar selecciona. Con notas seleccionadas: LIGAR (sin re-ataque; con GLIDE, portamento) y panorama L/C/R nota a nota.'],
  ['4 · Toca', 'Teclado de ordenador (A W S E D F T G Y H U J K O L P ;) o MIDI. Arma ● REC y toca: se cuantiza a la rejilla con un compás de cuenta atrás.'],
  ['5 · Rellena', 'RELLENAR escribe bajo, acordes, arpegio, melodía o batería sobre tu escala. VARIAR PISTA retoca lo que ya tienes.'],
  ['6 · Arregla', 'En ORDEN cada bloque es un patrón: doble clic reproduce desde ahí, arrastra para reordenar y ↺ marca a qué bloque vuelve la CANCIÓN al terminar (no confundir con REPETIR PATRÓN, que repite uno solo).'],
  ['7 · Exporta', 'EXPORTAR: WAV, stems por canal, MIDI, VGM/VGZ/XGM, proyecto o una ROM de Mega Drive que arranca sola y toca el tema (emulador o cartucho flash). En QUÉ EXPORTAR eliges la canción, solo el patrón seleccionado (en bucle) o cada patrón por separado en un ZIP; MUTE y SOLO cuentan. XGM y ROM muestran el presupuesto de cartucho del tema. COMPARTIR copia un enlace con todo el tema.'],
  ['8 · A tu medida', 'El engranaje elige el sonido (MODEL 1, con el grano del DAC y el filtro de la consola, o LIMPIO), el tamaño de la interfaz y dónde va el panel: a la derecha (pantallas 16:9) o abajo.'],
]

const KEYS: [string, string][] = [
  ['Espacio / Enter / Esc', 'Reproducir-parar / desde el inicio / parar y silenciar'],
  ['R', 'Armar grabación'],
  ['C', 'Repetir solo el patrón seleccionado (bucle de patrón)'],
  ['1 … 9, 0', 'Seleccionar pista'],
  ['Shift + 1 … 0', 'Silenciar / activar esa pista'],
  ['Alt + 1 … 0', 'Solo de esa pista (Alt + M quita todos los mute y solo)'],
  ['[  ]', 'Patrón anterior / siguiente'],
  ['Z / X', 'Octava del teclado −/+'],
  ['N M , .', 'Bombo, caja, hat, palmas (en cualquier pista)'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Deshacer / rehacer'],
  ['Ctrl+S', 'Guardar en la biblioteca local'],
  ['Ctrl+C V X D A', 'Copiar, pegar, cortar, duplicar, seleccionar todo (piano roll)'],
  ['Q', 'Cuantizar a la rejilla'],
  ['B', 'Ligar / soltar las notas seleccionadas'],
  ['← → ↑ ↓', 'Mover notas seleccionadas (Shift+↑↓ = octava)'],
  ['Supr', 'Borrar notas seleccionadas'],
  ['Ctrl + rueda', 'Zoom horizontal del piano roll (Shift + rueda: desplazar)'],
]

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="AYUDA" width={760}>
      <div className="flex flex-col gap-4">
        <div className="help-top">
          <Logo className="help-logo" />
          <p className="modal-p">
            Estudio de chiptune con emulación real del <b style={{ color: 'var(--accent)' }}>YM2612</b> (6 canales FM de 4 operadores + DAC PCM) y del <b style={{ color: 'var(--c-psg)' }}>SN76489</b> (3 cuadradas + ruido). Lo que oyes es lo que exporta el VGM, con el PSG al nivel que tiene en la consola.
          </p>
        </div>
        <div className="help-grid">
          {STEPS.map(([t, d]) => (
            <div key={t} className="panel-2 help-card">
              <div className="title-px">{t}</div>
              <p className="modal-p">{d}</p>
            </div>
          ))}
        </div>
        <div>
          <div className="title-px" style={{ marginBottom: '0.5rem' }}>
            ATAJOS
          </div>
          <div className="help-keys">
            {KEYS.map(([k, d]) => (
              <div key={k} className="contents">
                <span className="num">{k}</span>
                <span className="modal-p">{d}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="hint">Canales: FM1-FM5 + FM6/PCM (batería) · SQ1-SQ3 cuadradas · NOISE. Cada pista es una voz del chip: un acorde escrito en una sola pista se arpegia a 60 Hz, como en los drivers de la época.</p>
        <p className="hint">
          El núcleo FM deriva de Genesis Plus GX (Eke-Eke), que parte del fm.c de MAME (Jarek Burczynski y Tatsuyuki Satoh).{' '}
          <a href="/licencias.txt" target="_blank" rel="noopener" style={{ color: 'var(--accent-hi)', textDecoration: 'underline' }}>
            Créditos y licencias
          </a>{' · '}
          <a href="https://github.com/TZOOTZ/chip-console" target="_blank" rel="noopener" style={{ color: 'var(--accent-hi)', textDecoration: 'underline' }}>
            Código fuente
          </a>
        </p>
      </div>
    </Modal>
  )
}
