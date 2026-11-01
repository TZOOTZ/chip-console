// ── Entrada MIDI (Web MIDI API) ─────────────────────────────────────────────
import { liveOff, liveOn } from './controller'

let access: MIDIAccess | null = null

export function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
}

function handle(e: MIDIMessageEvent): void {
  const d = e.data
  if (!d || d.length < 2) return
  const status = d[0] & 0xf0
  const note = d[1]
  const vel = d.length > 2 ? d[2] : 0
  if (status === 0x90 && vel > 0) liveOn(note, Math.max(1, Math.min(15, Math.round((vel / 127) * 15))))
  else if (status === 0x80 || (status === 0x90 && vel === 0)) liveOff(note)
}

function attach(onDevices: (names: string[]) => void): void {
  if (!access) return
  const names: string[] = []
  access.inputs.forEach((input) => {
    input.onmidimessage = handle
    names.push(input.name ?? 'MIDI')
  })
  onDevices(names)
}

/** Pide acceso y escucha todos los puertos de entrada (incluidos los que se conecten después). */
export async function enableMidi(onDevices: (names: string[]) => void): Promise<boolean> {
  if (!midiSupported()) return false
  try {
    access = await navigator.requestMIDIAccess({ sysex: false })
    access.onstatechange = () => attach(onDevices)
    attach(onDevices)
    return true
  } catch {
    return false
  }
}

export function disableMidi(): void {
  if (!access) return
  access.inputs.forEach((input) => (input.onmidimessage = null))
  access.onstatechange = null
  access = null
}
