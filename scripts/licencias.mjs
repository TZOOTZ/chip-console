// Genera public/licencias.txt: los avisos de todo el código de terceros que llega al navegador o a una
// ROM exportada. Se ejecuta a mano (`npm run licencias`) al cambiar de dependencias; el resultado se sube.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SEP = '='.repeat(78)
// lo que entra en el bundle (scheduler llega por react-dom)
const PAQUETES = ['react', 'react-dom', 'scheduler', 'zustand', 'immer', 'fflate', '@fontsource/press-start-2p', '@fontsource/vt323', '@fontsource/space-mono']

function licenciaDe(pkg) {
  const dir = join('node_modules', pkg)
  const f = readdirSync(dir).find((n) => /^licen[cs]e/i.test(n))
  if (!f) throw new Error('Sin fichero de licencia: ' + pkg)
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  return `${pkg} ${version}\n\n${readFileSync(join(dir, f), 'utf8').trim()}`
}

for (const f of ['src/core/LICENSE-ym2612.txt', 'rom/LICENSE-SGDK.txt']) {
  if (!existsSync(f)) throw new Error('Falta ' + f)
}

const secciones = [
  `TZOOTZ RESEARCH · Chip Console — créditos y licencias de terceros

El núcleo del YM2612 (src/core/ym2612.ts) es un port a TypeScript, con cambios, del ym2612.c de
Genesis Plus GX, que a su vez parte del fm.c de MAME. Su licencia y sus autores, a continuación.

Código fuente completo de esta app: https://github.com/TZOOTZ/chip-console`,
  readFileSync('src/core/LICENSE-ym2612.txt', 'utf8').trim(),
  `Las ROM exportadas llevan código de SGDK:\n\n${readFileSync('rom/LICENSE-SGDK.txt', 'utf8').trim()}`,
  ...PAQUETES.map(licenciaDe),
]

writeFileSync('public/licencias.txt', secciones.join(`\n\n${SEP}\n\n`) + '\n')
console.log(`public/licencias.txt: ${secciones.length} secciones`)
