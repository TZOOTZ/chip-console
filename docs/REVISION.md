# Revisión del proyecto original (v0) y qué se hizo

Punto de partida: una plantilla React + Vite + shadcn con una "Chip Console" funcional pero
básica (teclado, 8 pistas de 1 nota, grabación y exportadores VGM/XGM/XM). Se revisó el código
completo y estos son los hallazgos, ordenados por impacto.

## Fallos reales encontrados

| # | Hallazgo | Impacto | Solución |
|---|---|---|---|
| 1 | `freqToFnum` usaba `2^(20-b)`; la fórmula del YM2612 es `2^(21-b)` (C4 = bloque 4 / fnum 644). | El VGM/XGM sonaba **una octava grave** respecto a la previsualización. | Fórmula correcta + test de afinación (< 1 cent hasta la octava 1). |
| 2 | Los registros de operador se escribían en el orden lógico op1-op2-op3-op4, pero el chip usa **S1-S3-S2-S4**. | Operadores 2 y 3 intercambiados: timbres FM distintos en hardware. | Tabla de offsets `[0, 8, 4, 12]` + test que identifica cada operador por su frecuencia. |
| 3 | XGM: los frames con comandos no emitían el `$00` de fin de frame. | Tiempos incorrectos en el reproductor. | Exportador reescrito siguiendo SGDK `xgm.txt` v1.01 + test con lector de referencia. |
| 4 | PSG por debajo de A2 (periodo > 1023) quedaba desafinado en el export. | Notas graves del PSG fuera de tono. | Plegado de octava idéntico en preview y export. |
| 5 | Secuenciador con `setTimeout` y note-off por temporizador. | Jitter de tiempos y degradación con la pestaña en segundo plano; un note-off tardío podía cortar la nota siguiente. | Driver a la muestra dentro de un AudioWorklet. |
| 6 | Cada pista solo podía repetir **una** nota fija; máx. 4 compases, un solo patch FM compartido. | Imposible escribir melodías. | Modelo de canción con patrones, notas con duración/velocidad y banco de instrumentos. |
| 7 | La previsualización (osciladores WebAudio) y el export (registros) eran dos motores distintos. | Lo exportado no sonaba como lo oído. | Un solo driver; el VGM es el registro de sus escrituras. |

## Limpieza

- Eliminados 40+ componentes shadcn sin usar, `Home.tsx` de plantilla, react-router, `components.json`,
  el plugin `kimi-plugin-inspect-react` y decenas de dependencias; fuentes autoalojadas (sin Google Fonts).
- `package.json`: 0 vulnerabilidades en dependencias de producción.

## Qué se conserva del original

Estética CRT fósforo, nombre/marca TZOOTZ RESEARCH, mapa de teclado (A W S E D F T G Y H U J K O L P ;),
Z/X para octava, N M , . para batería, y los exportadores VGM/VGZ/XGM (reescritos). El exportador XM
(módulo FastTracker) se sustituye por stems WAV + MIDI, que son lo que realmente se lleva a un DAW.
