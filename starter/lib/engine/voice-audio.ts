// Small audio helpers for tier 2 (ticket 12): WAV length, and wrapping the audio
// model's streamed PCM16 in a WAV header so the phone can play it.

import type { AudioClip } from "./voice-agent"

/** Seconds of audio in a PCM WAV clip, from its header; null when it is not a readable WAV. */
export function wavSeconds(clip: AudioClip): number | null {
  if (clip.format !== "wav") return null
  const bytes = Buffer.from(clip.data, "base64")
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return null
  let offset = 12
  let byteRate = 0
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    if (id === "fmt ") byteRate = bytes.readUInt32LE(offset + 16)
    if (id === "data") return byteRate ? Math.round((Math.min(size, bytes.length - offset - 8) / byteRate) * 10) / 10 : null
    offset += 8 + size + (size % 2)
  }
  return null
}

/** Mono 16-bit PCM samples as a WAV file. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8)
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40)
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]))
}
