// Speech for tier-1 prompts (ticket 10): the `Speech` port turns a prompt into
// audio once and caches it by text, voice and model, so a fixed question costs
// one generation ever. Audio bytes live behind the `AudioStore` port (disk in the
// app, memory in tests; S3 or Postgres can implement the same two methods).
//
// Adapters (both through `cachedSpeech`, which owns the cache and the wait):
// - `azureSpeech` (voice-azure.ts): Azure AI Speech neural voices, the default.
// - `openRouterSpeech` POSTs to OpenRouter's OpenAI-compatible
//   `/api/v1/audio/speech` (binary MP3 back). The response carries no usage, so the
//   cost is the model's listed price per character times the characters sent.
// - `scriptedSpeech` (call-testing.ts) for tests: no network.
// A failed generation never stops a call: the prompt is shown as text without audio.

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export type Spoken = {
  /** Id of the cached audio (serve it from the audio route); null when no audio could be made. */
  audioId: string | null
  /** How long the prompt takes to say, in seconds (from the audio, or estimated from the words). */
  seconds: number
  /** Model cost of this generation in USD; 0 on a cache hit. */
  cost: number
  cached: boolean
  model: string | null
  /** Why there is no audio, when there is none. */
  error?: string
}

export interface Speech {
  speak(text: string): Promise<Spoken>
}

export type StoredAudio = { bytes: Uint8Array; contentType: string; seconds: number; model: string; text: string }

export interface AudioStore {
  get(id: string): Promise<StoredAudio | null>
  put(id: string, audio: StoredAudio): Promise<void>
}

/** Words per second of a calm phone voice, for prompts that have no audio. */
const WORDS_PER_SECOND = 2.6

export function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round((words / WORDS_PER_SECOND) * 10) / 10)
}

export function audioIdFor(model: string, voice: string, text: string): string {
  return createHash("sha256").update([model, voice, text].join("\n")).digest("hex").slice(0, 32)
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]

/** The duration of a constant-bitrate MP3 from its first frame header; null when it can't be read. */
export function mp3Seconds(bytes: Uint8Array): number | null {
  let offset = 0
  // Skip an ID3v2 tag.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.length > 10) {
    offset = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f))
  }
  for (let i = offset; i < Math.min(bytes.length - 3, offset + 4096); i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue
    const version = (bytes[i + 1] >> 3) & 0x3 // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (bytes[i + 1] >> 1) & 0x3 // 1 = layer III
    if (layer !== 1 || version === 1) continue
    const index = bytes[i + 2] >> 4
    const kbps = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[index]
    if (!kbps) continue
    return Math.round(((bytes.length - i) * 8 / (kbps * 1000)) * 10) / 10
  }
  return null
}

export function createMemoryAudioStore(): AudioStore {
  const audio = new Map<string, StoredAudio>()
  return {
    async get(id) { return audio.get(id) ?? null },
    async put(id, value) { audio.set(id, value) },
  }
}

/** Audio as files: `<dir>/<id>.mp3` plus `<id>.json` with its facts. */
export function createDiskAudioStore(dir: string): AudioStore {
  const safe = (id: string) => { if (!/^[a-f0-9]{8,64}$/.test(id)) throw new Error(`Not an audio id: ${id}`); return id }
  return {
    async get(id) {
      try {
        const meta = JSON.parse(await readFile(path.join(dir, `${safe(id)}.json`), "utf8")) as Omit<StoredAudio, "bytes">
        const bytes = await readFile(path.join(dir, `${safe(id)}.mp3`))
        return { ...meta, bytes: new Uint8Array(bytes) }
      } catch {
        return null
      }
    },
    async put(id, { bytes, ...meta }) {
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, `${safe(id)}.mp3`), bytes)
      await writeFile(path.join(dir, `${safe(id)}.json`), JSON.stringify(meta))
    },
  }
}

export type OpenRouterSpeechOptions = {
  apiKey: string
  store: AudioStore
  model?: string
  voice?: string
  /** USD per character sent, from the model's listed price. */
  pricePerChar?: number
  baseUrl?: string
  /** Hard limit on one generation. */
  timeoutMs?: number
  /** How long a call waits for audio before the prompt goes out as text (the generation still fills the cache). */
  waitMs?: number
  fetch?: typeof fetch
}

/**
 * The spec names `openai/gpt-4o-mini-tts`, but OpenRouter does not serve it (the
 * speech endpoint answers "Model ... does not exist", October 2026). Of the models
 * listed with `output_modalities=speech`, fish-audio/s1 answered a short prompt in
 * about a second; hexgrad/kokoro-82m is 25x cheaper but took about 25 s per prompt.
 * Override with SPEECH_MODEL / SPEECH_VOICE / SPEECH_PRICE_PER_MILLION_CHARS.
 */
export const DEFAULT_SPEECH_MODEL = "fish-audio/s1"
export const DEFAULT_SPEECH_VOICE = "alloy"
/** Listed price of the default model: $15 per million characters. */
export const DEFAULT_SPEECH_PRICE_PER_CHAR = 15 / 1_000_000

export function openRouterSpeech(options: OpenRouterSpeechOptions): Speech {
  const model = options.model ?? DEFAULT_SPEECH_MODEL
  const voice = options.voice ?? DEFAULT_SPEECH_VOICE
  const base = options.baseUrl ?? "https://openrouter.ai/api/v1"
  const doFetch = options.fetch ?? fetch
  return cachedSpeech({
    store: options.store, model, voice, pricePerChar: options.pricePerChar ?? DEFAULT_SPEECH_PRICE_PER_CHAR, waitMs: options.waitMs,
    async synthesize(text) {
      const response = await doFetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text, voice, response_format: "mp3" }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
      })
      if (!response.ok) throw new Error(`speech ${response.status}: ${(await response.text()).slice(0, 200)}`)
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "audio/mpeg" }
    },
  })
}

export type CachedSpeechOptions = {
  store: AudioStore
  /** Model and voice name the cache key and the cost line. */
  model: string
  voice: string
  /** USD per character sent. */
  pricePerChar: number
  /** How long a call waits for audio before the prompt goes out as text (the generation still fills the cache). */
  waitMs?: number
  /** One generation: MP3 bytes for the text; throws on failure. */
  synthesize(text: string): Promise<{ bytes: Uint8Array; contentType: string }>
}

/**
 * Speech around one provider's `synthesize`: cache by model, voice and text, one
 * generation at a time per prompt, priced per character, and never longer than
 * `waitMs` for the call.
 */
export function cachedSpeech(options: CachedSpeechOptions): Speech {
  const { model, voice } = options
  const pending = new Map<string, Promise<Spoken>>()
  async function generate(text: string, id: string): Promise<Spoken> {
    const hit = await options.store.get(id)
    if (hit) return { audioId: id, seconds: hit.seconds, cost: 0, cached: true, model }
    try {
      const { bytes, contentType } = await options.synthesize(text)
      const seconds = mp3Seconds(bytes) ?? estimateSeconds(text)
      await options.store.put(id, { bytes, contentType, seconds, model, text })
      return { audioId: id, seconds, cost: text.length * options.pricePerChar, cached: false, model }
    } catch (error) {
      return { audioId: null, seconds: estimateSeconds(text), cost: 0, cached: false, model, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const waitMs = options.waitMs ?? 8_000
  return {
    async speak(text) {
      const id = audioIdFor(model, voice, text)
      let run = pending.get(id)
      if (!run) {
        run = generate(text, id).finally(() => pending.delete(id))
        pending.set(id, run)
      }
      // A slow generation must not hold up the call: after `waitMs` the prompt goes
      // out as text, and the generation carries on to fill the cache for next time.
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<Spoken>((resolve) => {
        timer = setTimeout(() => resolve({ audioId: null, seconds: estimateSeconds(text), cost: 0, cached: false, model, error: `no audio within ${waitMs} ms` }), waitMs)
      })
      try {
        return await Promise.race([run, late])
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** Speech from the environment: null without OPENROUTER_API_KEY (prompts then show as text only). */
export function openRouterSpeechFromEnv(store: AudioStore): Speech | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return openRouterSpeech({
    apiKey, store,
    model: process.env.SPEECH_MODEL || undefined,
    voice: process.env.SPEECH_VOICE || undefined,
    pricePerChar: process.env.SPEECH_PRICE_PER_MILLION_CHARS ? Number(process.env.SPEECH_PRICE_PER_MILLION_CHARS) / 1_000_000 : undefined,
  })
}
