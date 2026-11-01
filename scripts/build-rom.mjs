// Compila la ROM reproductora (rom/player) con SGDK y deja en rom/player.bin el binario
// que la app lleva dentro y al que añade cada tema (src/export/rom.ts).
//
// Uso: npm run rom:build
// Necesita SGDK 2.11 (https://github.com/Stephane-D/SGDK) y Java en el PATH. La carpeta de
// SGDK se indica con la variable TZ_SGDK; por defecto, ../megadrive-tools/sgdk211.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** dirección a partir de la cual la app escribe el tema: la reproductora tiene que caber por debajo */
const SONG_BASE = 0x20000

const gdk = (process.env.TZ_SGDK ?? path.resolve('..', 'megadrive-tools', 'sgdk211')).replaceAll('\\', '/')
if (!existsSync(`${gdk}/makefile.gen`)) {
  console.error(`No encuentro SGDK en ${gdk}. Indica su carpeta con la variable TZ_SGDK.`)
  process.exit(1)
}

const win = process.platform === 'win32'
const env = { ...process.env, GDK: gdk }
if (win) {
  // las herramientas de SGDK traen su propio MSYS: no debe mezclarse con el de la consola actual
  env.PATH = `${gdk.replaceAll('/', '\\')}\\bin;${process.env.SystemRoot}\\System32;${path.dirname(process.execPath)};${process.env.PATH}`
  for (const k of Object.keys(env)) if (/^(MSYS|MINGW|CHERE|SHELL$|TERM$)/.test(k)) delete env[k]
}
const make = win ? `${gdk}/bin/make.exe` : 'make'
const run = spawnSync(make, ['-f', `${gdk}/makefile.gen`], { cwd: 'rom/player', env, stdio: 'inherit' })
if (run.status !== 0) {
  console.error('La compilación de la ROM ha fallado.')
  process.exit(run.status ?? 1)
}

const rom = readFileSync('rom/player/out/rom.bin')
// SGDK rellena con ceros hasta 128 KB: aquí se guarda sin ese relleno (la app lo repone)
let end = rom.length
while (end > 0x200 && rom[end - 1] === 0) end--
end = Math.ceil(end / 256) * 256
if (end > SONG_BASE) {
  console.error(`La reproductora ocupa ${end} bytes y no cabe por debajo de $${SONG_BASE.toString(16)}.`)
  process.exit(1)
}
writeFileSync('rom/player.bin', rom.subarray(0, end))
console.log(`rom/player.bin: ${end} bytes (${(end / 1024).toFixed(1)} KB)`)
