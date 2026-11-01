# TZOOTZ RESEARCH · Chip Console — Mega Drive Studio

Estudio de **chiptune en el navegador** con emulación real de los dos chips de sonido de la
Sega Mega Drive: **YM2612** (6 canales FM de 4 operadores + DAC PCM) y **SN76489** (3 cuadradas +
ruido). Genera temas completos, edítalos en un piano roll, toca en vivo con grabación y exporta a
**WAV, stems, MIDI, VGM/VGZ, XGM y una ROM de Mega Drive** que arranca sola y toca el tema. Lo que
oyes es exactamente lo que se exporta al VGM.

- **En producción:** <https://tz-megadrive.roty340.workers.dev> (Cloudflare Workers · Static Assets)
- 100 % cliente: sin servidor, sin cuentas, funciona offline (PWA instalable).
- **Licencia:** el núcleo FM no permite venta ni uso comercial; ver [Licencia](#licencia).

## Empezar en 30 segundos

1. Abre la app y pulsa para encender.
2. **COMPONER → GENERAR TEMA** (estilo + tónica; *OTRO* crea una canción nueva con otra semilla).
   Estilos: **COSMIC DISCO**, **TECHNO MINIMAL**, **DARK**, **JAZZ FUSION**, **JAZZ SWING**, TZOOTZ ERA, aventura, jefe final y house 1992.
   ¿Prefieres empezar de cero? **NUEVO** (cabecera, o en la propia pantalla de arranque) crea un tema
   en blanco con el título, tempo, compás, tono y sonidos que elijas.
3. **Espacio** reproduce desde el patrón seleccionado, **Enter** desde el inicio.
4. Edita en el piano roll: clic = nota, arrastrar = longitud/mover, clic derecho = borrar.
5. Activa **● REC** y toca (teclado de ordenador o MIDI): se cuantiza con cuenta atrás de un compás.
6. **EXPORTAR** (WAV / stems / MIDI / VGM / VGZ / XGM / ROM / proyecto) o **COMPARTIR** (enlace), arriba a la derecha.

Pulsa **?** dentro de la app para ver todos los atajos.

## Interfaz (pensada para 16:9)

```
┌─ logo · transporte · LCD (posición, BPM, compás, tono, título) · deshacer · ⚙ · nuevo · compartir · exportar ─┐
│ CANALES  │ PATRONES + ORDEN (línea de tiempo)         │ COMPONER · INSTRUMENTO · CANCIÓN │
│ 10 voces │ piano roll, con toda la altura             │ (inspector)                      │
├──────────┴─────────────────────────────────────────────┴──────────────────────────────────┤
│ pista activa · octava │ teclado en pantalla (3 octavas) / pads        │ osciloscopio       │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Inspector a la derecha** en pantallas panorámicas (ancho útil ≥ 1180 px y proporción ≥ 1,45), de modo
  que el piano roll se queda con toda la altura; en el resto va abajo. Se fija en **⚙ → PANEL**.
- **Escala automática por resolución.** Toda la interfaz está medida en `rem` y el lienzo de diseño es
  de 1536×864: 1366×768 y 1600×900 → 100 %, 1920×1080 → 125 %, 2560×1440 → 165 %, 4K → 250 %.
  Se cambia a mano en **⚙ → TAMAÑO** (90–200 %). El canvas del piano roll escala con ella.
- **Orden como línea de tiempo:** cada bloque es un patrón con su compás de inicio y un ancho
  proporcional a su duración; doble clic reproduce desde ahí, se arrastra para reordenar y `↺` marca
  el bloque al que vuelve la canción al terminar. **REPETIR PATRÓN** (botón junto a COMPASES, el de
  bucle del transporte o la tecla `C`) repite en bucle solo el patrón seleccionado y apaga el resto del
  orden mientras tanto.
- **Mute y solo con el teclado:** `Shift + 1…0` silencia o activa esa pista, `Alt + 1…0` la solea y `Alt + M` deja sonar todo; el botón `M/S ✕` de
  CANALES hace lo mismo con el ratón.
- **Presupuesto de ROM al exportar** (XGM y ROM): el diálogo mide en un worker lo que ocupa el tema (música, comprimida y muestras), cuánto dura, el bucle
  y cómo cumple las [reglas de ahorro](#presupuesto-de-rom) (kit único, golpes cortos, dinámicas, ruido, envolventes del PSG, arpegios, modulación, parches, bucle).
- **Piano roll:** teclas de piano a la izquierda (se iluminan al tocar), silueta de la nota antes de
  hacer clic, zoom con Ctrl + rueda anclado al cursor, y en pistas de batería arrastrar *pinta* un
  golpe por paso de rejilla.
- **TEMA NUEVO** (botón NUEVO): un patrón vacío con el reparto de pistas que elijas — el banco
  BÁSICO o los sonidos y el kit de cualquiera de los estilos, sin una sola nota. El tema anterior se
  recupera con Ctrl+Z.
- Tamaño, posición del panel, teclado y efecto CRT se recuerdan en `localStorage`.

### Marca

El logotipo vive en [`src/ui/logoShapes.ts`](src/ui/logoShapes.ts) (tres formas: trébol, círculo y coma) y
de ahí salen el componente `<Logo>` (cabecera, pantalla de arranque, pie y ayuda) y, con
`node scripts/make-icons.mjs`, `public/logo.svg`, el favicon y los iconos de la PWA. El SVG original
exportado de Inkscape se conserva en [`docs/brand/logo-original.svg`](docs/brand/logo-original.svg).

## Características

| Área | Qué hay |
|---|---|
| **Sonido** | Emulación de YM2612 (8 algoritmos, envolventes AR/D1R/SL/D2R/RR con KS, DT, MUL, TL, feedback, LFO AM/PM, DAC, pan) y SN76489 (tonos, ruido blanco/periódico, atenuación de 2 dB) en un **AudioWorklet** con tiempo exacto a la muestra. Dos caracteres de sonido (**⚙ → SONIDO**): **MODEL 1** —DAC discreto de 9 bits con su escalón en el cruce por cero y el paso-bajo de la placa— o **LIMPIO**. El PSG va al nivel que tiene en la consola y sin aliasing. |
| **Composición rápida** | Generador de temas en 9 estilos con semilla (ver más abajo); rellenar pista (bajo, acordes, arpegio, melodía, batería, percusión) en el lenguaje del estilo elegido; variar pista; progresiones y acordes diatónicos; bloqueo de escala. |
| **Edición** | Piano roll en canvas (selección múltiple, copiar/pegar/duplicar, cuantizar, velocidad, notas fantasma), patrones + orden con bucle, 10 canales con mute/solo/volumen/pan, deshacer/rehacer, autoguardado, biblioteca local. |
| **Expresión** | **Ligaduras y portamento**: una nota ligada (`LIGAR`, tecla B) no vuelve a atacar y, con el `GLIDE` de la pista, el tono se desliza hasta ella. **Panorama nota a nota** (L/C/R) en FM y batería. **La velocidad abre el timbre**, no solo el volumen (`VEL→T` del parche). `GATE` por pista. Todo son escrituras de registro: viaja al VGM y al XGM. |
| **Instrumentos** | Editor FM de 4 operadores con diagrama de algoritmo y envolventes; 29 presets FM (bajos, teclas, leads, cuerdas, campana techno, stab, ácido, theremin y los de jazz: saxo, guitarra, contrabajo y vibráfono); 12 presets PSG con envolvente, vibrato y caída de tono (láser); kit de ruido (6) y kit PCM (8) sintetizados: bombo, caja, hats, palmas, toms, rim, cencerro, **syndrum/láser**, **timbal afinable** (dos octavas, un semitono cada 1/24 del mando TONO) y **plato**. |
| **Entrada** | Teclado de ordenador y en pantalla, **Web MIDI**, acordes en una sola pista = arpegio a 60 Hz (como los drivers reales). **Importar** un MIDI, un VGM/VGZ o un proyecto (arrastrándolo a la ventana o en CANCIÓN → IMPORTAR…). |
| **Salida** | WAV 16/24/32f · stems por canal (ZIP) · MIDI SMF1 · **VGM/VGZ** (bucle + GD3) · **XGM** (SGDK) · **ROM de Mega Drive** (`.bin`, con el driver XGM dentro: para emulador o cartucho flash) · proyecto JSON · enlace compartible (la canción va en la URL). Cada formato sale de la **canción entera, del patrón seleccionado (en bucle) o de cada patrón por separado en un ZIP** (los stems, una carpeta por patrón); MUTE y SOLO cuentan en todos, MIDI incluido. |

## Estilos del generador

| Estilo | Tempo | Qué genera |
|---|---|---|
| **COSMIC DISCO** | 114–124 | Space disco **serio y teatral, siempre en menor**. Ocho progresiones con cadencia (lamento, círculo de quintas, épica, ascenso, canon, napolitana, marcha, heroica): dominante mayor con sensible y segunda rebajada solo en sus compases. El tema nace de una de las 16 ideas escritas a mano y se desarrolla como un período clásico: exposición · secuencia · clímax (más agudo o con una idea de contraste) · cadencia. Bajo secuenciado, cuerdas a tres voces con coro, arpegio con eco, segunda voz en terceras en el FINAL, **timbales afinados a la tónica y la dominante** y plato. **Nada se repite compás a compás**: bajo y batería tienen compás normal, variante, giro de mitad de frase (palmas dobladas, recogida de bombo, anticipo del acorde siguiente) y cierre que deja sitio al redoble, distinto en cada sección. El tema liga las notas cortas con un punto de portamento y, al final de A, se asoma de un altavoz al otro antes de exponerse entero. El puente lo canta a mitad de velocidad sobre pedal de dominante y la coda cierra con cadencia perfecta. |
| **TECHNO MINIMAL** | 132–140 | Detroit hipnótico: kit tipo 909, armonía estática, un riff de campana de un compás cuyo ciclo de alturas no cuadra con el de ritmo (se va desfasando) y que salta de lado a lado cuando entran los stabs, stabs a tres voces con *planing*, blips en polirritmia (3, 5 o 6 contra 16) y bajo sub, rodante o ácido (con los saltos de octava ligados, como el *slide* de una 303). Menor o frigio. |
| **DARK** | 110–130 | Dos caras según la semilla: **EBM** (bajo en semicorcheas con segunda menor, percusión industrial, zumbido de ruido) o **giallo** (pulso en corcheas, arpegio con sexta menor, coro con trémolo, campana o un theremin que se desliza de nota a nota). Frigio, con cadencias i–bII, i–bVI–bII–V o andaluza. |
| TZOOTZ ERA | 108–116 | ADN ERA001: Do menor, sus2, i–bVI–bVII–i, bajo sine, 606 y hook de notas repetidas. |
| **JAZZ FUSION** | 100–126 | Jazz de arcade, el de Galaxy Force II, Thunder Blade o Thunder Force: vamp dórico o menor con II–V (IV9, bVII9 y una dominante alterada al final que tira del bucle), bajo slap, **teclado a tres voces** (tercera, séptima y extensión) con el vibráfono arriba, saxo o metal con la línea por la escala del acorde y las notas de paso ligadas, eco en el PSG y batería de rock ligero con caja fantasma. |
| **JAZZ SWING** | 132–168 | Corchea con swing 2:1 a tempo de negra (el swing se aplica sobre corcheas: `swingGrid` 4 y 33 %), bajo andante con aproximación cromática, guitarra tipo Freddie Green con el vibráfono arriba, saxo, ride «tu-tu-ku», pedal y bombo a pluma; «cambios de ritmo», «hojas de otoño» y «el tren A». |
| AVENTURA · JEFE FINAL · HOUSE 1992 | 136–172 / 120–128 | Los estilos de videojuego: plataformas en mayor, menor armónica a toda velocidad y house de slap bass. |

**El jazz** ([`src/music/jazz.ts`](src/music/jazz.ts)). Los acordes se escriben como `raíz:tipo` sobre la tónica
(`2:m7,7:alt` = dos acordes por compás) y todo sale de ellos: la voz grave del teclado va a FM2, la media a FM3
y la aguda a FM5 con la conducción de voces más corta (de media, menos de un semitono por voz); el bajo
andante elige el registro de cada fundamental por programación dinámica —también el salto de vuelta al
principio del bucle— y llega a la siguiente por una nota de paso o una aproximación cromática; la melodía
pone notas del acorde en los apoyos, camina por su escala entre apoyo y apoyo y acaba cada frase de cuatro
compases en una nota larga. El swing se compone en pasos de corchea y al escribirlo cada paso ocupa dos semicorcheas, con `swingGrid` 4 (el motor balancea parejas de corcheas, no de semicorcheas). El tema es INTRO · HEAD ×2 · SOLO · SOLO 2 · BRIDGE (una cuarta arriba, termina
en la dominante) · OUT HEAD ×2 · TAG, y vuelve al HEAD. La batería usa solo tres niveles de golpe (15·9·5).
Los cuatro sonidos nuevos del banco FM —SAX, JAZZ GUITAR, WALK BASS y VIBES— se añadieron al final.

En los tres primeros (y en los dos de jazz) los acordes sostenidos se reparten en **tres canales FM** (una nota por canal, con
conducción de voces), así que suenan como un acorde real y no como el arpegio de 60 Hz. Cada estilo
configura además su kit de batería, los nombres, volúmenes y panoramas de las pistas.

**Cómo se cura COSMIC DISCO** ([`src/music/cosmic.ts`](src/music/cosmic.ts)). Las ideas melódicas se escriben
como `grado.duración` sobre la fundamental del acorde (`'4.6 3.2 2.4 0.4'` = quinta con puntillo y
descenso), con las notas fuertes en notas del acorde o en apoyaturas que resuelven. Al ser relativas,
la misma idea suena sobre cualquier acorde: eso es una secuencia. Cada compás se coloca en la octava
que deja la melodía en su registro, por encima de las cuerdas. Añadir una progresión o una idea es
añadir una línea a `COSMIC_PROGS` o `COSMIC_IDEAS`.

## Importar MIDI y VGM

**CANCIÓN → IMPORTAR…** o arrastrar el archivo sobre la ventana. El tipo se reconoce por el contenido (`.json`, `.mid`, `.vgm`, `.vgz`) y el
importador se descarga solo al usarlo. Al terminar sale un informe con lo medido, lo que no cabía y lo que se ha perdido.

- **MIDI** ([`src/import/midi.ts`](src/import/midi.ts), SMF 0 y 1). La percusión del canal 10 va al kit. Lo demás se separa en voces monofónicas (cada nota
  toma la voz libre de altura más cercana: un acorde son varias voces) y se reparte por altura: la más grave al bajo (FM1), la más aguda a la melodía (FM4),
  las del medio a FM2/FM3/FM5 y, si sobran, a las cuadradas; con más de ocho voces se quedan las que más suenan. El programa General MIDI elige el
  instrumento (piano, órgano, cuerdas, metales, saxo, vibráfono…). Salen el tempo, el compás y la tonalidad; las notas se cuantizan a semicorcheas o,
  si el archivo tiene swing de tresillo, a la rejilla con swing. El tema se trocea en patrones de 8 compases sin repetir los iguales.
- **VGM / VGZ** ([`src/import/vgm.ts`](src/import/vgm.ts)). Un VGM es el registro de escrituras al chip, sin partitura, y se reconstruye: cada canal del
  YM2612 es una pista con **su parche leído de los registros** (algoritmo, realimentación, operadores, panorama), añadido al banco FM; el volumen de las
  portadoras (TL) da la dinámica; las tres cuadradas y el ruido del SN76489 dan SQ1-SQ3 y la pista de ruido; los golpes del DAC (con banco de PCM y
  comandos 0x8n) se recortan como **muestras de 8 bits** y forman el kit (los ocho que más suenan). El **tempo** se mide con la rejilla de semicorcheas que
  mejor encaja con los inicios de nota (con decimales: 7 frames por paso son 128,57 BPM; la canción lleva el entero más cercano), con swing si lo hay, y el
  **bucle** del VGM se conserva: el compás 1 se alinea para que la canción vuelva a empezar donde vuelve él. Un vibrato o un barrido de tono corto no
  son notas; una altura que se sostiene 4 frames sí (nota ligada); un arpegio rápido es un acorde en la pista, como lo escribe la app.

Lo que no cabe en el modelo se pierde con aviso: los vibratos y barridos, el SSG-EG, el modo de tres frecuencias del canal 3, los cambios de parche dentro de un
canal (se usa el principal), los cambios de tempo y los demás chips. Con lo que exporta la propia app la ida y vuelta es exacta en tempo, bucle, swing y
notas FM y de PSG (`tests/import-midi.test.ts`, `tests/import-vgm.test.ts`); la batería sale como muestras porque el DAC de un VGM exportado es una mezcla.

## Presupuesto de ROM

[`src/export/presupuesto.ts`](src/export/presupuesto.ts) mide lo que cuesta un tema en un cartucho sobre las escrituras
reales del driver y el XGC compilado (el mismo binario que acabaría en la ROM), y lo compara con diez reglas de ahorro:

| # | Regla | Cómo se mide |
|---|---|---|
| 1 | Un solo kit para todos los temas | El 909 de TECHNO MINIMAL (`KIT_909`) cuenta como compartido; lo propio de un tema son 1-3 muestras cortas que caben en los 4,9 KB libres del banco |
| 2 | Golpes cortos (1 KB ≈ 94 ms) | Bombo ≤ 150 ms, caja y palmas ≤ 120 ms, charles ≤ 20 ms |
| 3 | Pocas dinámicas | Cada nivel de velocidad es otra muestra: cada sonido, a un nivel o a dos |
| 4 | Charles y aire por el DAC | Nada de percusión en el ruido del PSG |
| 5 | Envolventes del PSG de ≤ 4 pasos | Se mide el volumen escrito por nota |
| 6 | Acordes en 3 canales, nunca un arpegio a 60 Hz en uno | Se mide el número de pasos con más de una nota en una pista |
| 7 | Sin portamento, vibrato ni automatización salvo como firma | Se cuentan las escrituras por frame |
| 8 | Un parche por canal | Parches distintos por pista |
| 9 | Repetir exacto y variar poco | Lo que ahorra comprimir los comandos; 120 BPM (7,5 frames por paso), 150 (6) y 90 (10) son los tempos que mejor repiten en la rejilla de frames del driver |
| 10 | Sin coda, intro ≤ 4 compases, bucles de 1:10 a 1:40 | Duración y punto de bucle |

### Muestras reales (PCM)

Un sonido del kit puede ser una **muestra real** (`kind: "sample"`, PCM de 8 bits en base64 y su frecuencia): no se
sintetiza, se reproduce tal cual, viaja en el proyecto y en el enlace y entra en el XGM con su tamaño. Hoy entra importando
un VGM, o a mano en un proyecto; [`src/export/muestra.ts`](src/export/muestra.ts) convierte un WAV a ese formato: mono,
recortado al golpe, con la subida de tono que haga falta (una octava más aguda ocupa la mitad) y a 8 bits. Ojo con la
licencia de lo que metas: una muestra comprada no suele poder publicarse suelta, y un enlace compartido la lleva dentro.

## Cómo funciona (arquitectura)

```
src/core/      Chips (TypeScript puro, sin DOM)
  ym2612.ts      emulación OPN2: operadores, EG, LFO, DAC
  sn76489.ts     emulación PSG
  mixer.ts       ChipConsole: remuestreo (FM por área; PSG a 4× + FIR), modelo de sonido (Model 1 / limpio),
                 filtro subsónico (20 Hz) y limitador suave
src/engine/    El "sound driver"
  synth.ts       secuenciador + driver: notas → escrituras de registros (tiempo = muestras)
  drums.ts       síntesis de batería PCM de 8 bit determinista
  worklet.ts     AudioWorkletProcessor (corre synth en el hilo de audio)
  client.ts      cliente del hilo principal (contexto, mensajes, analizador)
src/music/     Modelo y teoría
  song.ts        modelo de canción (JSON inmutable) + saneamiento
  edit.ts        operaciones de edición   theory.ts  escalas/acordes
  generator.ts   generador (ERA y estilos de videojuego) y tema en blanco   presets.ts bancos de fábrica
  cosmic.ts      COSMIC DISCO: progresiones, ideas melódicas, timbales   genkit.ts utilidades comunes
  electro.ts     TECHNO MINIMAL y DARK   electrokit.ts base de los tres (bajo, acordes a tres voces, arpegios)
  jazz.ts        JAZZ FUSION y JAZZ SWING: acordes, voces, bajo andante, melodía por frases, kit de jazz
src/import/    importar MIDI (midi.ts) y VGM (vgm.ts, con vgmParse.ts, ymTrack.ts, psgTrack.ts y la rejilla de tempo grid.ts); patterns.ts trocea en patrones
src/export/    render offline, WAV, MIDI, VGM (+lector), XGM, compartir, worker
  escopo.ts      qué se exporta: canción, patrón seleccionado o cada patrón (patternSong, nombres de archivo)
  xgc.ts         compilador XGM → XGC (lo que lee el driver del Z80)   rom.ts  montaje de la ROM
rom/           la ROM reproductora: fuente en C para SGDK (player/) y el binario que usa la app (player.bin)
src/state/     store (zustand+immer), controlador, persistencia, MIDI
src/ui/        cabecera, canales, arreglo, piano roll, inspector (paneles), teclado, osciloscopio,
               logo y diálogo de tema nuevo
src/index.css  sistema de diseño en rem (la escala de la interfaz es el font-size de <html>)
```

**Un único camino de sonido.** El driver (`Synth`) escribe registros reales en los chips. En tiempo
real eso suena por el worklet; en exportación se *registran* las mismas escrituras con su marca de
tiempo. Por eso el VGM exportado, reproducido con el lector del proyecto, es **idéntico** al render
directo (diferencia < 1e-6, hay test).

### Fidelidad y límites conocidos

- YM2612: tablas log-seno/exp y de tasas del EG, retardo de una muestra del MEM y del operador 1,
  realimentación y orden de slots S1-S3-S2-S4 como el chip. Sin SSG-EG, sin modo CH3 de 3
  frecuencias y sin temporizadores.
- **Model 1** (por defecto): cada canal se trunca a 9 bits y pasa por el DAC discreto del YM2612, con
  su escalón en el cruce por cero (el *ladder effect*: +4 LSB si el canal es positivo, −3 si es
  negativo, y el signo se cuela incluso por el lado silenciado). Detrás, el paso-bajo de primer
  orden de la placa (3,39 kHz). Es lo que hace que un fundido no se apague del todo y que los
  agudos suenen "a consola". **Limpio** suma a 14 bits y no filtra. El WAV se exporta con el modelo
  elegido; el VGM y el XGM son escrituras de registro y no dependen de él.
- SN76489: LFSR de 16 bit (variante Sega), ruido acoplado a SQ3; las notas por debajo de A2
  (periodo > 1023) se pliegan una octava arriba, como haría un compositor en hardware real.
  - **Nivel:** un canal de PSG a tope queda 10,9 dB por debajo de uno de FM, entre las dos
    referencias disponibles (libgme, medido: −9,8 dB; Genesis Plus GX: −11,8 dB). Los temas
    guardados con la calibración anterior (PSG 7,5 dB más alto) se convierten al abrirlos: sube el
    volumen de las pistas de PSG y, si no basta, la velocidad de sus notas, hasta donde da el chip.
  - **Aliasing:** las cuadradas se llevan a 4× la tasa de salida y se diezman con un FIR de 96
    coeficientes: lo que no es armónico queda por debajo de −50 dB.
  - **Afinación:** el periodo es un entero de 10 bits y a partir de Fa♯6 los saltos superan lo
    tolerable; el generador baja de octava las notas que desafinarían más de 7 cents.
- DAC: 11 / 14.7 / 22 kHz a 8 bit; hasta 4 golpes simultáneos mezclados por software (si llega un
  quinto se sacrifica el que está a punto de acabar: un charles antes que un plato o un timbal).
  FM6 y PCM comparten canal (`⇄` en la pista 6).
- XGM: cuantizado a frames (limitación del formato) y 3 niveles de velocidad por sonido. Un frame es
  un retrazo vertical de la consola: 59,92 por segundo en NTSC, no 60.

### La ROM y la prueba en una consola emulada

**EXPORTAR → ROM** da un `.bin` que arranca solo: logo, título, autor, tono y tempo en pantalla, y el
tema sonando con el **driver XGM de SGDK** en el Z80 (START pausa; A, B o C vuelven al principio).
Por dentro es la reproductora de [`rom/`](rom/README.md) más el tema compilado a XGC, el formato que
lee el driver. Ese compilador ([`src/export/xgc.ts`](src/export/xgc.ts)) es un port del de `xgmtool`.

`npm run test:rom` lo comprueba con las herramientas de verdad:

- **Contra `xgmtool` (SGDK 2.11):** el XGC sale **idéntico byte a byte** en 17 temas (los siete
  estilos con dos semillas, uno corto, uno sin bucle y uno vacío).
- **En MAME 0.289, con la máquina entera** (68000 + Z80 ejecutando el driver, sin ventana y grabando
  el audio): el FM y el PSG suenan a la misma nota que en la app (0,0 cents), el tempo no se mueve
  (0 ms de deriva a los 50 s), el PCM sale a 0,7 dB del nivel de la app y la envolvente de un tema
  cosmic entero casa con la del render propio (correlación 0,85; por familias, FM 0,89, PSG 0,84 y
  PCM 0,95).

Esa prueba encontró y obligó a corregir cuatro cosas del exportador XGM, que hasta entonces solo
se había validado contra su especificación:

1. La batería se renderizaba a 13,3 kHz y el driver la reproduce a 14 kHz: sonaba casi un semitono
   alta (y los timbales de cosmic van afinados).
2. El tiempo se cuantizaba a 60 frames por segundo; la consola da 59,92, así que el tema iba un
   0,13 % lento.
3. Los golpes se repartían por los cuatro canales de PCM por turno y el cuarto charles cortaba un
   plato; ahora cada golpe va al canal que antes queda libre, como en la app.
4. Dos atenuaciones del mismo canal del PSG en un frame podían salir en otro orden tras compilar
   (una nota colgada si la última era el silencio); ahora cada frame lleva solo la última.

Dos diferencias medidas que **no** son errores de la ROM:

- En MAME el PSG suena entre 3 y 4 dB más alto respecto al FM que en la app. Es su calibración: con las
  cuatro referencias a mano, un canal de PSG a tope queda a −8,5 dB (MAME), −9,8 (libgme), −10,9
  (esta app) y −11,8 dB (Genesis Plus GX) de uno de FM.
- En MAME el PCM se reproduce a 14,6 kHz, +75 cents sobre los 14,0 nominales. El driver está escrito
  para tardar 254 ciclos del Z80 por muestra (14 093 Hz); lo más probable es que la emulación no
  frene al Z80 cuando lee las muestras del cartucho y el bucle le salga más corto. No está
  comprobado en una consola: **nada de esto se ha probado en hardware real**, solo en emulador.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # chips, driver, Model 1, expresión, VGM, XGM/XGC, ROM, generador y estilos, presupuesto de ROM, rendimiento, escala de UI…
npm run check      # lint, tests y build: lo mismo que el CI, y npm run deploy no despliega sin pasarlo
npm run test:ref   # contraste con un reproductor VGM independiente (libgme; necesita ffmpeg en el PATH)
npm run test:rom   # XGC contra xgmtool y la ROM sonando en MAME (necesita SGDK y MAME; ver rom/README.md)
npm run rom:build  # recompila la ROM reproductora (necesita SGDK y Java)
npm run lint
npm run build      # tsc -b + vite build → dist/
```

Tests destacables: afinación FM/PSG a < 6 cents, mapeo de operadores y algoritmos, tiempos de
envolvente, VGM ≡ render directo, estructura XGM contra la especificación v1.01, coste del hilo de
audio (≈ 2 % del presupuesto) y niveles de salida. De la Model 1: un seno por debajo de un LSB sale
como la cuadrada de ±4/1024 que da el chip, el signo que se cuela por el lado silenciado, −3 dB en
el corte del filtro y cambio de modelo sin chasquido. De la expresión: una nota ligada no escribe ni
key-off ni key-on, el portamento dura los frames pedidos y acaba en la nota exacta, y el panorama y
el timbre por velocidad llegan al chip como escrituras de registro.

`npm run test:ref` exporta VGM de prueba, los decodifica con libgme (va dentro de ffmpeg) y compara
con el render propio: los 29 parches FM de fábrica quedan a menos de 1,5 dB por banda de octava, la
cuantización del DAC de 9 bits coincide, y el PSG frente al FM a menos de 1,2 dB. libgme no modela
el escalón del DAC ni el filtro de la placa: esa parte se comprueba contra las cifras del chip.

## Despliegue en Cloudflare

Proyecto aparte, Worker **`tz-megadrive`** con *Static Assets* (sin script de Worker):

```bash
npm run deploy         # build + wrangler deploy
npm run deploy:dry     # ensayo sin publicar
```

- Configuración: [`wrangler.jsonc`](wrangler.jsonc) · cabeceras y caché: [`public/_headers`](public/_headers)
  (CSP estricta `default-src 'self'`, assets con hash `immutable`, `sw.js`/`index.html` siempre revalidados).
- Service worker generado en build ([`scripts/sw-plugin.ts`](scripts/sw-plugin.ts)): offline-first.
- Dominio propio: *Workers & Pages → tz-megadrive → Settings → Domains & Routes → Add custom domain*,
  o añade un bloque `routes` en `wrangler.jsonc`.

## Formato de proyecto

JSON con una clave por línea (`.tzmd.json`): `version`, `bpm`, `swing`, `swingGrid` (2 = el swing balancea parejas de semicorcheas, 4 = de corcheas), `beatsPerBar`, `key`, `scale`,
`dacRate`, `lfo`, bancos (`fmBank`, `psgBank`, `noiseKit`, `drumKit`), `tracks` (10 canales fijos,
con `gate` y `glide`), `patterns[{id,name,bars,notes:{pista:[{step,len,note,vel,slide?,pan?}]}}]`,
`order` y `loopStart`. `sanitizeSong()` normaliza cualquier archivo importado o enlace compartido y
convierte los de la versión 1 a la calibración de PSG actual.

Los **enlaces compartidos** son un contenedor binario comprimido: una cabecera JSON con todo menos
las notas y, por patrón y pista, las notas en cuatro columnas (distancia al paso anterior, duración,
nota y velocidad, que lleva encima la ligadura y el panorama). Por columnas, el mismo arpegio tocado
más flojo solo difiere en una de ellas y deflate hace el resto: un tema generado ocupa 1–2,5 KB de
URL y cabe en un solo mensaje de cualquier chat. Los enlaces antiguos (JSON) se siguen abriendo.

El **orden de los bancos de fábrica no se toca**: los enlaces guardan el índice del parche y omiten el
banco cuando coincide con el de fábrica. Se añade al final y, a conciencia, se mejora el sonido de un
parche (SLAP BASS y GROWL están rehechos); nunca se mueve ni se quita.

## Créditos y procedencia

- **YM2612** ([`src/core/ym2612.ts`](src/core/ym2612.ts)): port a TypeScript, con cambios, del `ym2612.c` de
  [Genesis Plus GX](https://github.com/ekeeke/Genesis-Plus-GX) (© Eke-Eke, con las pruebas de Nemesis en
  consola real), que a su vez parte del `fm.c` de MAME (© Jarek Burczynski y Tatsuyuki Satoh). Vienen de ahí
  las tablas, la envolvente, el cálculo de operadores, el LFO de amplitud, el encendido de nota y el escalón
  del DAC. Es distinto el vibrato del LFO (por tabla de cents); no tiene SSG-EG, modo CH3 ni temporizadores.
  **Licencia:** la de Genesis Plus GX ([`src/core/LICENSE-ym2612.txt`](src/core/LICENSE-ym2612.txt)): prohíbe
  vender el código o usarlo en un producto o actividad comercial, y pide acompañar lo modificado de su código
  fuente completo: por eso este código es público.
- **SN76489** ([`src/core/sn76489.ts`](src/core/sn76489.ts)): escrito a partir de la documentación pública del
  chip; no se le ha identificado código de terceros.
- **Avisos:** la app sirve todos los de terceros en [`licencias.txt`](public/licencias.txt) (`npm run licencias`
  lo regenera al cambiar de dependencias).
- **XGM:** formato según `SGDK/bin/xgm.txt` v1.01. **VGM:** especificación 1.71 (GD3 incluido).
- **ROM:** la reproductora (`rom/player.bin`) contiene código de [SGDK](https://github.com/Stephane-D/SGDK)
  —su biblioteca y el driver XGM del Z80—, © Stephane Dallongeville, licencia MIT
  ([`rom/LICENSE-SGDK.txt`](rom/LICENSE-SGDK.txt)); el compilador XGC de la app es un port del de su
  `xgmtool`, con la misma licencia. El programa MAME solo se usa para las pruebas.
- **Tipografías:** Press Start 2P, VT323 y Space Mono (SIL OFL) vía `@fontsource`, autoalojadas.
- **Material musical del generador "TZOOTZ ERA":** reglas y motivos extraídos del archivo ERA001 del autor
  (sus2, i–bVI–bVII–i, hooks de notas repetidas, bajo sine, 606).

## Licencia

El código se publica para poder leerlo, compilarlo y comprobarlo, y para cumplir la licencia del núcleo FM. No es
una licencia abierta:

- **Núcleo YM2612:** la licencia de Genesis Plus GX ([`src/core/LICENSE-ym2612.txt`](src/core/LICENSE-ym2612.txt)). Prohíbe vender
  el código o usarlo en un producto o actividad comercial, y eso alcanza a cualquier versión de la app que lo lleve.
- **Terceros:** cada uno con la suya; los avisos están en [`licencias.txt`](public/licencias.txt).
- **El resto del código, el logo y el material musical:** © TZOOTZ RESEARCH, todos los derechos reservados.
