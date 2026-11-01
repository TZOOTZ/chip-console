# ROM reproductora

`player.bin` es una ROM de Mega Drive mínima: pinta el logo y la ficha del tema y lo toca con el
**driver XGM** del Z80. La app la lleva dentro tal cual; al elegir **EXPORTAR → ROM** copia este
binario, escribe el tema a partir de `$20000` y corrige la cabecera
([`src/export/rom.ts`](../src/export/rom.ts)). No hace falta compilar nada para exportar.

```
$000000  reproductora (este binario, rellena con ceros hasta $20000)
$020000  ficha: "TZMD", versión, bucle sí/no, BPM, duración en frames, título, autor, tono y tempo
$020100  XGC: tabla de muestras, muestras PCM (8 bit con signo, 14 kHz) y música compilada
   …     relleno hasta un múltiplo de 128 KB
```

En pantalla: **START** pausa y reanuda; **A**, **B** o **C** vuelven al principio.

## Compilarla

Solo hace falta si cambias `player/src/main.c` o el logo.

```bash
npm run rom:build
```

Necesita [SGDK 2.11](https://github.com/Stephane-D/SGDK) (trae su propio GCC para 68000) y Java en
el PATH. La carpeta de SGDK se indica con la variable `TZ_SGDK`; por defecto se busca en
`../megadrive-tools/sgdk211`. El logo (`player/res/logo.png`) sale de `node scripts/make-icons.mjs`.

## Probarla

```bash
npm run test:rom
```

Además de los tests que corren siempre (formato del XGC, cabecera, suma de control), compara el
compilador XGC con el `xgmtool` de SGDK byte a byte y arranca la ROM en MAME sin ventana para
medir lo que suena. Necesita SGDK y MAME (`TZ_SGDK`, `TZ_MAME`; por defecto
`../megadrive-tools/sgdk211` y `../megadrive-tools/mame0289`).

## Licencias

- `player.bin` contiene código de **SGDK** —la biblioteca `libmd`, el arranque (`player/src/boot/sega.s`
  es su archivo sin cambios) y el driver XGM del Z80—, © Stephane Dallongeville, bajo licencia MIT:
  [`LICENSE-SGDK.txt`](LICENSE-SGDK.txt). Se compila con GCC, cuya biblioteca de soporte (`libgcc`)
  permite enlazarla en programas con cualquier licencia (GCC Runtime Library Exception).
- El compilador de XGM a XGC de la app ([`src/export/xgc.ts`](../src/export/xgc.ts)) es un port del de
  `xgmtool`, también de SGDK y también MIT.
- `player/src/main.c`, `rom_head.c` y el logo son de este proyecto.

## Ejemplo

[`ejemplo/COSMIC_CIRCULO_0021.bin`](ejemplo/COSMIC_CIRCULO_0021.bin) es una ROM exportada tal cual por la
app (un tema cosmic disco de 2:11 en bucle, 384 KB) y `ejemplo/pantalla.png`, lo que muestra al
arrancar en MAME.
