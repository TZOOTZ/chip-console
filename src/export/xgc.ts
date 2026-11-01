// ── Compilador XGM → XGC: lo que lee el driver XGM del Z80 ───────────────────
//
// El XGM (xgm.ts) es el formato de intercambio; el driver de SGDK no lo toca tal
// cual: necesita la versión "compilada" (XGC), con los comandos de cada frame
// reordenados (PSG, luego FM, luego PCM), el tamaño de cada frame por delante,
// los disparos de PCM adelantados tres frames (lo que tarda el búfer del driver)
// y unos comandos de estado para poder pausar y reanudar.
//
// Esto es un port literal de la conversión de `xgmtool` (SGDK, © Stephane
// Dallongeville, licencia MIT): tools/xgmtool/src/{xgc,xgccom,xgm,xgmcom,ym2612}.c.
// Se conserva su estructura —lista doblemente enlazada incluida— para que el
// resultado sea idéntico byte a byte al de la herramienta original; hay un test
// que lo compara con `xgmtool.exe` (tests/rom.test.ts, `npm run test:rom`).
// No se convierten las etiquetas GD3 (nuestro XGM no las lleva).

const XGM_FRAME = 0x00
const XGM_PSG = 0x10
const XGM_YM2612_PORT0 = 0x20
const XGM_YM2612_PORT1 = 0x30
const XGM_YM2612_REGKEY = 0x40
const XGM_PCM = 0x50
const XGM_LOOP = 0x7e
const XGM_END = 0x7f

const XGC_PSG_TONE = 0x10
const XGC_PSG_ENV = 0x18
const XGC_STATE = 0x60
const XGC_FRAME_SKIP = 0x7d
const XGC_FRAME_SIZE = 1

/** frames que se adelanta cada disparo de PCM (NTSC) */
export const XGC_PCM_ADVANCE = 3
/** lo que admite el driver en un frame, y el tamaño a partir del cual xgmtool lo parte en dos */
const FRAME_MAX = 255
const FRAME_SPLIT = 250

interface Cmd {
  command: number
  data: number[]
  size: number
  offset: number
}

interface Sample {
  index: number
  data: Uint8Array
}

// ── lista doblemente enlazada, con la misma semántica que la de xgmtool ─────
interface Node<T> {
  el: T
  prev: Node<T> | null
  next: Node<T> | null
}
type List<T> = Node<T> | null

const createElement = <T>(el: T): Node<T> => ({ el, prev: null, next: null })
function connectNext<T>(e: List<T>, next: List<T>): void {
  if (e) e.next = next
  if (next) next.prev = e
}
function connectPrev<T>(e: List<T>, prev: List<T>): void {
  if (e) e.prev = prev
  if (prev) prev.next = e
}
function head<T>(l: List<T>): List<T> {
  if (!l) return null
  while (l.prev) l = l.prev
  return l
}
function tail<T>(l: List<T>): List<T> {
  if (!l) return null
  while (l.next) l = l.next
  return l
}
/** inserta detrás de `linked` y devuelve el nodo nuevo */
function insertAfter<T>(linked: List<T>, el: T): Node<T> {
  const n = createElement(el)
  if (linked) {
    connectNext(n, linked.next)
    connectPrev(n, linked)
  }
  return n
}
/** inserta delante de `linked` y devuelve el nodo nuevo */
function insertBefore<T>(linked: List<T>, el: T): Node<T> {
  const n = createElement(el)
  if (linked) {
    connectPrev(n, linked.prev)
    connectNext(n, linked)
  }
  return n
}
function insertAllAfter<T>(linked: List<T>, elements: List<T>): List<T> {
  let dst = linked
  for (let src = elements; src; src = src.next) dst = insertAfter(dst, src.el)
  return dst
}
/** desengancha el nodo (que conserva sus propios enlaces, como en el original) */
function removeFrom<T>(n: Node<T>): void {
  if (n.next) n.next.prev = n.prev
  if (n.prev) n.prev.next = n.next
}

// ── comandos ────────────────────────────────────────────────────────────────
const create = (data: number[]): Cmd => ({ command: data[0] & 0xff, data, size: data.length, offset: -1 })
const frameSizeCmd = (): Cmd => ({ command: XGC_FRAME_SIZE, data: [0], size: 1, offset: -1 })
const frameSkipCmd = (): Cmd => create([XGC_FRAME_SKIP])
const loopCmd = (offset: number): Cmd => create([XGM_LOOP, offset & 0xff, (offset >> 8) & 0xff, (offset >> 16) & 0xff])
const endCmd = (): Cmd => create([XGM_END])

const isFrame = (c: Cmd): boolean => c.command === XGM_FRAME
const isLoop = (c: Cmd): boolean => c.command === XGM_LOOP
const isEnd = (c: Cmd): boolean => c.command === XGM_END
const isPcm = (c: Cmd): boolean => (c.command & 0xf0) === XGM_PCM
const isPsg = (c: Cmd): boolean => (c.command & 0xf0) === XGM_PSG
const isPort0 = (c: Cmd): boolean => (c.command & 0xf0) === XGM_YM2612_PORT0
const isPort1 = (c: Cmd): boolean => (c.command & 0xf0) === XGM_YM2612_PORT1
const isYmWrite = (c: Cmd): boolean => isPort0(c) || isPort1(c)
const isKey = (c: Cmd): boolean => (c.command & 0xf0) === XGM_YM2612_REGKEY
const isFrameSize = (c: Cmd): boolean => c.command === XGC_FRAME_SIZE
const isFrameSkip = (c: Cmd): boolean => c.command === XGC_FRAME_SKIP

/** tamaño de un comando XGM a partir de su primer byte */
function xgmCommandSize(command: number): number {
  const n = command & 0x0f
  switch (command & 0xf0) {
    case XGM_PSG:
    case XGM_YM2612_REGKEY:
      return 1 + n + 1
    case XGM_YM2612_PORT0:
    case XGM_YM2612_PORT1:
      return 1 + (n + 1) * 2
    case XGM_PCM:
      return 2
    case 0x70:
      return n === 0x0e ? 4 : 1
    default:
      return 1
  }
}

/** quita de un comando de escrituras al puerto 0 las del registro `reg`; false si se queda vacío */
function removePort0Reg(c: Cmd, reg: number): boolean {
  if (!isPort0(c)) return true
  const count = (c.data[0] & 0x0f) + 1
  const data = [0]
  for (let i = 0; i < count; i++) {
    const r = c.data[i * 2 + 1]
    if (r !== reg) data.push(r, c.data[i * 2 + 2])
  }
  const kept = (data.length - 1) >> 1
  if (kept !== count) {
    if (kept === 0) return false
    data[0] = (c.data[0] & 0xf0) | (kept - 1)
    c.data = data
    c.size = kept * 2 + 1
  }
  return true
}

/** agrupa valores sueltos en comandos de `max` como mucho */
function group(values: number[], base: number, max: number): List<Cmd> {
  let out: List<Cmd> = null
  for (let i = 0; i < values.length; i += max) {
    const part = values.slice(i, i + max)
    out = insertAfter(out, create([base | (part.length - 1), ...part]))
  }
  return head(out)
}

/** un comando XGM → los XGC equivalentes */
function convertSingle(c: Cmd): List<Cmd> {
  let result: List<Cmd> = null
  const type = c.command === XGM_FRAME || c.command === XGM_LOOP || c.command === XGM_END ? c.command : c.command & 0xf0
  if (type === XGM_PSG) {
    const n = (c.data[0] & 0x0f) + 1
    const env: number[] = []
    const tone: number[] = []
    // tal cual el original: "envolvente" es lo que tiene los bits 7, 4 y 0 a uno
    for (let i = 0; i < n; i++) ((c.data[i + 1] & 0x91) === 0x91 ? env : tone).push(c.data[i + 1])
    if (env.length) result = insertAllAfter(result, group(env, XGC_PSG_ENV, 4))
    if (tone.length) result = insertAllAfter(result, group(tone, XGC_PSG_TONE, 8))
  } else if (type === XGM_YM2612_REGKEY) {
    const n = (c.data[0] & 0x0f) + 1
    result = insertAllAfter(result, group(c.data.slice(1, 1 + n), XGM_YM2612_REGKEY, 6))
  } else result = insertAfter(result, c)
  return head(result)
}
function convert(commands: List<Cmd>): List<Cmd> {
  let result: List<Cmd> = null
  for (let src = commands; src; src = src.next) result = insertAllAfter(result, convertSingle(src.el))
  return head(result)
}

// ── estado del YM2612 que el driver necesita seguir ─────────────────────────
class YmState {
  readonly reg: Int16Array[] = [new Int16Array(0x100).fill(-1), new Int16Array(0x100).fill(-1)]
  readonly init: Uint8Array[] = [new Uint8Array(0x100), new Uint8Array(0x100)]

  copy(): YmState {
    const s = new YmState()
    for (let p = 0; p < 2; p++) {
      s.reg[p].set(this.reg[p])
      s.init[p].set(this.init[p])
    }
    return s
  }
  static canIgnore(port: number, reg: number): boolean {
    switch (reg) {
      case 0x22:
      case 0x24:
      case 0x25:
      case 0x26:
      case 0x27:
      case 0x28:
      case 0x2b:
        return port === 1
    }
    if (reg >= 0x30 && reg < 0xb8) return (reg & 3) === 3
    return true
  }
  get(port: number, reg: number): number {
    return YmState.canIgnore(port, reg) ? 0 : this.reg[port][reg]
  }
  set(port: number, reg: number, value: number): void {
    if (YmState.canIgnore(port, reg)) return
    let v = value
    if (port === 0) {
      if (reg === 0x28) {
        // el estado de las teclas se guarda en los registros 0-7
        this.reg[0][value & 7] = value & 0xf0
        return
      }
      if (reg === 0x27) v &= 0xc0
    }
    this.reg[port][reg] = v
    this.init[port][reg] = 1
  }
  isDiff(old: YmState, port: number, reg: number): boolean {
    if (!this.init[port][reg] && !old.init[port][reg]) return false
    return !((this.init[port][reg] || YmState.canIgnore(port, reg)) && this.get(port, reg) === old.get(port, reg))
  }
}

/** cambios de SL/RR (por operador) y del DAC respecto al frame anterior: pares [dirección en el driver, valor] */
function stateChange(cur: YmState, old: YmState): number[] {
  const out: number[] = []
  let addr = 0x44
  for (let port = 0; port < 2; port++) {
    let reg = 0x80
    while (reg < 0x90) {
      if (cur.isDiff(old, port, reg)) out.push(addr, cur.get(port, reg) & 0xff)
      addr++
      reg += (reg & 3) === 2 ? 2 : 1
    }
  }
  if (cur.isDiff(old, 0, 0x2b)) out.push(0x44 + 0x1c, cur.get(0, 0x2b) & 0xff)
  return out
}
function stateCommands(pairs: number[]): List<Cmd> {
  let out: List<Cmd> = null
  for (let i = 0; i < pairs.length; i += 32) {
    const part = pairs.slice(i, i + 32)
    out = insertAfter(out, create([XGC_STATE | ((part.length >> 1) - 1), ...part]))
  }
  return head(out)
}

// ── lectura del XGM ─────────────────────────────────────────────────────────
interface Xgm {
  pal: boolean
  samples: Sample[]
  commands: List<Cmd>
}

function parseXgm(data: Uint8Array): Xgm {
  if (data.length < 0x108 || String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'XGM ') throw new Error('No es un archivo XGM')
  const u16 = (o: number): number => data[o] | (data[o + 1] << 8)
  const samples: Sample[] = []
  for (let s = 1; s < 0x40; s++) {
    const offset = u16(s * 4)
    const len = u16(s * 4 + 2)
    // entrada vacía: se salta (misma comprobación que el original)
    if (offset !== 0xffff && len !== 0x0100) samples.push({ index: s, data: data.subarray((offset << 8) + 0x104, (offset << 8) + 0x104 + (len << 8)) })
  }
  const music = (u16(0x100) << 8) + 0x104
  const length = (data[music] | (data[music + 1] << 8) | (data[music + 2] << 16) | (data[music + 3] << 24)) >>> 0
  let commands: List<Cmd> = null
  let off = 0
  while (off < length) {
    const at = music + 4 + off
    const size = xgmCommandSize(data[at])
    const c = create(Array.from(data.subarray(at, at + size)))
    commands = insertAfter(commands, c)
    off += size
    if (isEnd(c)) break
  }
  return { pal: (data[0x103] & 1) === 1, samples, commands: head(commands) }
}

function musicDataSizeOf(commands: List<Cmd>): number {
  let n = 0
  for (let c = commands; c; c = c.next) n += c.el.size
  return n
}
function computeAllOffset(commands: List<Cmd>): void {
  let offset = 0
  for (let c = commands; c; c = c.next) {
    c.el.offset = offset
    offset += c.el.size
  }
}
function loopCommandOf(commands: List<Cmd>): Cmd | null {
  for (let c = commands; c; c = c.next) if (isLoop(c.el)) return c.el
  return null
}
/** el comando al que apunta el bucle */
function loopPointedCommand(commands: List<Cmd>): Cmd | null {
  const loop = loopCommandOf(commands)
  if (!loop) return null
  const target = loop.data[1] | (loop.data[2] << 8) | (loop.data[3] << 16)
  let offset = 0
  for (let c = commands; c; c = c.next) {
    if (offset === target) return c.el
    offset += c.el.size
  }
  return null
}

function computeAllFrameSize(commands: List<Cmd>): void {
  let sizeCommand: Cmd | null = null
  let size = 0
  for (let c = commands; c; c = c.next) {
    if (isFrameSize(c.el)) {
      if (sizeCommand) sizeCommand.data[0] = size & 0xff
      sizeCommand = c.el
      size = 1
    } else size += c.el.size
  }
  if (sizeCommand) sizeCommand.data[0] = size & 0xff
}

// ── de XGM a XGC ────────────────────────────────────────────────────────────
function extractMusic(xgm: Xgm, split: number): List<Cmd> {
  let ymOld: YmState
  let ym = new YmState()

  // tres frames vacíos por delante: el sitio al que se adelantan los primeros PCM
  let xgc: List<Cmd> = createElement(frameSizeCmd())
  xgc = insertAfter(xgc, frameSizeCmd())
  xgc = insertAfter(xgc, frameSizeCmd())

  const loopTarget = loopPointedCommand(xgm.commands)
  let loopOffset = -1
  let loopEnd = false

  let com = xgm.commands
  while (com) {
    // comandos de este frame
    let frame: List<Cmd> = null
    while (com) {
      const command: Cmd = com.el
      com = com.next
      if (command === loopTarget && loopOffset === -1) loopOffset = musicDataSizeOf(head(xgc))
      if (isEnd(command)) continue
      if (isLoop(command)) {
        loopEnd = true
        continue
      }
      if (isFrame(command)) break
      frame = insertAfter(frame, command)
    }
    frame = head(frame)

    ymOld = ym
    ym = ymOld.copy()

    let sizeCommand = frameSizeCmd()
    let fresh: List<Cmd> = createElement(sizeCommand)

    let ymOther: List<Cmd> = null
    let ymKey: List<Cmd> = null
    let ymCommands: List<Cmd> = null
    let psg: List<Cmd> = null
    let other: List<Cmd> = null
    let hasKey = false

    for (let t = frame; t; t = t.next) {
      const command = t.el
      if (isPsg(command)) psg = insertAfter(psg, command)
      else if (isKey(command)) {
        ymKey = insertAfter(ymKey, command)
        hasKey = true
      } else if (isYmWrite(command)) {
        // el orden entre teclas y registros importa: lo acumulado sale ya
        if (hasKey) {
          ymOther = head(ymOther)
          ymKey = head(ymKey)
          if (ymOther) ymCommands = insertAllAfter(ymCommands, convert(ymOther))
          if (ymKey) ymCommands = insertAllAfter(ymCommands, convert(ymKey))
          ymOther = null
          ymKey = null
          hasKey = false
        }
        const port = isPort0(command) ? 0 : 1
        const count = (command.data[0] & 0x0f) + 1
        for (let j = 0; j < count; j++) ym.set(port, command.data[j * 2 + 1], command.data[j * 2 + 2])
        // el driver activa el DAC por su cuenta: sobran las escrituras a $2B
        if (removePort0Reg(command, 0x2b)) ymOther = insertAfter(ymOther, command)
      } else other = insertAfter(other, command)
    }

    // un solo PCM por canal y frame: se queda el último
    const pcmOnChannel: (Cmd | null)[] = [null, null, null, null]
    for (let t = other; t; t = t.prev) {
      const command = t.el
      if (!isPcm(command)) continue
      const ch = command.data[0] & 3
      if (pcmOnChannel[ch]) {
        removeFrom(t)
        if (t === other) other = t.prev
      } else pcmOnChannel[ch] = command
    }

    ymOther = head(ymOther)
    ymKey = head(ymKey)
    if (ymOther) ymCommands = insertAllAfter(ymCommands, convert(ymOther))
    if (ymKey) ymCommands = insertAllAfter(ymCommands, convert(ymKey))

    psg = head(psg)
    ymCommands = head(ymCommands)
    other = head(other)

    // primero el PSG (necesita el bus principal), luego el FM y al final el PCM
    if (psg) fresh = insertAllAfter(fresh, convert(psg))
    if (ymCommands) fresh = insertAllAfter(fresh, ymCommands)
    if (other) fresh = insertAllAfter(fresh, convert(other))

    const changed = stateChange(ym, ymOld)
    if (changed.length) fresh = insertAllAfter(fresh, stateCommands(changed))

    if (loopEnd && loopOffset !== -1) {
      fresh = insertAfter(fresh, frameSkipCmd())
      fresh = insertAfter(fresh, loopCmd(loopOffset))
      loopOffset = -1
    }
    if (com === null) {
      if (loopOffset !== -1) {
        fresh = insertAfter(fresh, frameSkipCmd())
        fresh = insertAfter(fresh, loopCmd(loopOffset))
        loopOffset = -1
      } else fresh = insertAfter(fresh, endCmd())
    }

    fresh = head(fresh)

    // un frame no puede pasar de 255 bytes: si se acerca, se parte en dos que el driver lee seguidos
    let size = 0
    for (let t = fresh; t; t = t.next) {
      const command = t.el
      if (size + command.size >= split) {
        insertBefore(t, frameSkipCmd())
        sizeCommand.data[0] = (size + 1) & 0xff
        sizeCommand = frameSizeCmd()
        insertBefore(t, sizeCommand)
        size = 1
      }
      size += command.size
    }
    sizeCommand.data[0] = size & 0xff

    xgc = insertAllAfter(xgc, fresh)
  }

  const out = head(xgc)
  computeAllOffset(out)
  computeAllFrameSize(out)
  return out
}

/** adelanta `sft` frames cada disparo de PCM y repone al final los que el bucle se saltaría */
function shiftSamples(commands: List<Cmd>, sft: number): void {
  if (sft === 0) return
  const loop = loopCommandOf(commands)
  const loopTarget = loopPointedCommand(commands)

  const pending: List<Cmd>[] = Array.from({ length: sft }, () => null)
  const loopSamples: List<Cmd>[] = Array.from({ length: sft }, () => null)

  let loopFrameIndex = sft
  let frameRead = 0
  let frameWrite = 0
  let com = tail(commands)

  while (com) {
    const command = com.el
    if (command === loopTarget) loopFrameIndex = 0

    if (isPcm(command)) {
      pending[frameRead] = insertAfter(pending[frameRead], command)
      removeFrom(com)
    } else if (isFrameSize(command)) {
      frameRead = (frameRead + 1) % sft
      frameWrite = (frameWrite + 1) % sft
      while (pending[frameWrite] !== null) {
        const sample: Cmd = pending[frameWrite]!.el
        pending[frameWrite] = pending[frameWrite]!.prev
        // justo delante de este frame (es decir, al final del anterior)
        com = insertBefore(com, sample)
        if (loopFrameIndex < sft) loopSamples[loopFrameIndex] = insertAfter(loopSamples[loopFrameIndex], create(sample.data))
      }
      loopFrameIndex++
    }
    com = com.prev
  }

  // lo que quedara por colocar va al primer frame
  for (let i = 0; i < sft; i++) {
    while (pending[i] !== null) {
      insertAfter(commands, pending[i]!.el)
      pending[i] = pending[i]!.prev
    }
  }

  // los PCM del arranque del bucle se adelantaron a antes del punto de bucle: al volver no
  // sonarían, así que se repiten en los últimos frames del tema
  com = tail(commands)
  if (com) com = com.prev
  loopFrameIndex = 0
  while (loopFrameIndex < sft && com) {
    if (isFrameSize(com.el)) {
      while (loopSamples[loopFrameIndex] !== null) {
        const sample: Cmd = loopSamples[loopFrameIndex]!.el
        loopSamples[loopFrameIndex] = loopSamples[loopFrameIndex]!.prev
        insertAfter(com, sample)
      }
      loopFrameIndex++
    }
    com = com.prev
  }

  computeAllOffset(commands)
  computeAllFrameSize(commands)

  if (loop && loopTarget) {
    const offset = loopTarget.offset
    loop.data[1] = offset & 0xff
    loop.data[2] = (offset >> 8) & 0xff
    loop.data[3] = (offset >> 16) & 0xff
  }
}

/** bytes que ocupa de verdad el frame más cargado (su byte de tamaño solo llega a 255) */
function largestFrame(commands: List<Cmd>): number {
  let max = 0
  let size = 0
  for (let c = commands; c; c = c.next) {
    if (isFrameSize(c.el)) {
      max = Math.max(max, size)
      size = 1
    } else size += c.el.size
  }
  return Math.max(max, size)
}

function compile(xgmFile: Uint8Array, split: number): { xgm: Xgm; commands: List<Cmd> } {
  const xgm = parseXgm(xgmFile)
  const commands = extractMusic(xgm, split)
  shiftSamples(commands, xgm.pal ? 2 : XGC_PCM_ADVANCE)
  return { xgm, commands }
}

export interface Xgc {
  /** el binario que se pasa a XGM_startPlay() */
  data: Uint8Array
  /** frames de 1/60 s hasta el final (o hasta que el tema vuelve al punto de bucle) */
  frames: number
  /** frame al que vuelve el bucle; -1 si el tema acaba */
  loopFrame: number
  /** bytes de muestras PCM */
  sampleBytes: number
  /** el frame más cargado, en bytes (el driver admite 255) */
  maxFrameBytes: number
}

/** Compila un archivo XGM (v1.01) al binario que reproduce el driver XGM de SGDK. */
export function compileXgc(xgmFile: Uint8Array): Xgc {
  // Los frames se parten antes de adelantar los PCM, y uno partido justo en el límite puede
  // recibir después varios y pasarse de lo que cabe (la herramienta original lo dejaría así y el
  // driver se perdería). Si ocurre, se repite partiendo antes: deja de ser idéntico a xgmtool,
  // pero es un XGC válido.
  let split = FRAME_SPLIT
  let { xgm, commands } = compile(xgmFile, split)
  while (largestFrame(commands) > FRAME_MAX && split > 64) {
    split -= 16
    ;({ xgm, commands } = compile(xgmFile, split))
  }

  // ── medidas ──
  let frames = 0
  let loopFrame = -1
  const maxFrameBytes = largestFrame(commands)
  const loopTarget = loopPointedCommand(commands)
  for (let c = commands; c; c = c.next) {
    if (c.el === loopTarget) loopFrame = frames
    if (isFrameSize(c.el)) frames++
    else if (isFrameSkip(c.el)) frames--
  }

  // ── volcado ──
  const out: number[] = []
  let offset = 0
  for (const s of xgm.samples) {
    out.push((offset >> 8) & 0xff, (offset >> 16) & 0xff, (s.data.length >> 8) & 0xff, (s.data.length >> 16) & 0xff)
    offset += s.data.length
  }
  for (let i = xgm.samples.length; i < 0x3f; i++) out.push(0xff, 0xff, 0x01, 0x00)
  out.push((offset >> 8) & 0xff, (offset >> 16) & 0xff)
  out.push(0x00) // versión
  out.push(xgm.pal ? 1 : 0)
  const headLen = out.length
  const music = musicDataSizeOf(commands)
  const data = new Uint8Array(headLen + offset + 4 + music)
  data.set(out, 0)
  let p = headLen
  for (const s of xgm.samples) {
    data.set(s.data, p)
    p += s.data.length
  }
  data[p++] = music & 0xff
  data[p++] = (music >> 8) & 0xff
  data[p++] = (music >> 16) & 0xff
  data[p++] = (music >>> 24) & 0xff
  for (let c = commands; c; c = c.next) {
    const cmd = c.el
    // salvo el tamaño de frame, el código de comando va ×2: es el índice de la tabla de saltos del Z80
    data[p++] = isFrameSize(cmd) ? cmd.data[0] : (cmd.data[0] << 1) & 0xff
    for (let i = 1; i < cmd.size; i++) data[p++] = cmd.data[i]
  }
  return { data, frames, loopFrame, sampleBytes: offset, maxFrameBytes }
}
