// Azure AI Speech adapters (the phone's audio; Anthropic has no speech models).
//
// - `azureSpeech`: text to speech over REST (`<region>.tts.speech.microsoft.com`),
//   SSML in, MP3 out, through `cachedSpeech` (cache, wait, price per character).
// - `azureTranscriber`: the ear, the short-audio REST recognizer
//   (`<region>.stt.speech.microsoft.com`, up to 60 s per clip). The phone sends 16 kHz
//   mono PCM WAV, which it takes as is; OGG Opus works too.
//
// Neither response carries a cost: both are priced from Azure's list prices (neural
// TTS $16 per million characters, real-time STT $1 per audio hour). The free F0 tier
// is not charged at all, but the cost meter shows what the calls would cost.
//
// There is no Azure audio-in, audio-out model here: the voice agent runs its fallback
// (the ear, Haiku's reply, this text to speech) unless OpenRouter's audio model is on.

import type { AudioStore, Speech } from "./speech"
import { cachedSpeech, openRouterSpeechFromEnv } from "./speech"
import type { AudioClip, Heard, Transcriber } from "./voice-agent"
import { wavSeconds } from "./voice-audio"
import { openRouterTranscriberFromEnv } from "./voice-openrouter"

export const DEFAULT_AZURE_VOICE = "en-US-AvaMultilingualNeural"
export const DEFAULT_AZURE_LANGUAGE = "en-US"
/** Neural voices: $16 per million characters. */
export const AZURE_TTS_PRICE_PER_CHAR = 16 / 1_000_000
/** Real-time speech to text: $1 per audio hour. */
export const AZURE_STT_PRICE_PER_SECOND = 1 / 3600

type AzureOptions = { key: string; region: string; fetch?: typeof fetch; timeoutMs?: number }

export function azureSpeech(options: AzureOptions & { store: AudioStore; voice?: string; pricePerChar?: number; waitMs?: number }): Speech {
  const voice = options.voice ?? DEFAULT_AZURE_VOICE
  const doFetch = options.fetch ?? fetch
  // The voice's locale ("en-US" from "en-US-AvaMultilingualNeural").
  const lang = voice.split("-").slice(0, 2).join("-")
  return cachedSpeech({
    store: options.store, model: `azure/${voice}`, voice, pricePerChar: options.pricePerChar ?? AZURE_TTS_PRICE_PER_CHAR, waitMs: options.waitMs,
    async synthesize(text) {
      const response = await doFetch(`https://${options.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": options.key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "bahn-control-room",
        },
        body: `<speak version="1.0" xml:lang="${lang}"><voice name="${xml(voice)}">${xml(text)}</voice></speak>`,
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      })
      if (!response.ok) throw new Error(`speech ${response.status}: ${(await response.text()).slice(0, 200) || response.statusText}`)
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: "audio/mpeg" }
    },
  })
}

export function azureTranscriber(options: AzureOptions & { language?: string; pricePerSecond?: number }): Transcriber {
  const language = options.language ?? DEFAULT_AZURE_LANGUAGE
  const price = options.pricePerSecond ?? AZURE_STT_PRICE_PER_SECOND
  const model = `azure/stt-${language}`
  const doFetch = options.fetch ?? fetch
  return {
    async transcribe(clip: AudioClip): Promise<Heard> {
      const bytes = Buffer.from(clip.data, "base64")
      const response = await doFetch(`https://${options.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=simple`, {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": options.key, "Content-Type": contentType(clip, bytes), Accept: "application/json" },
        body: bytes,
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      })
      const body = await response.text()
      if (!response.ok) throw new Error(`transcription ${response.status}: ${body.slice(0, 200) || response.statusText}`)
      const parsed = JSON.parse(body) as { RecognitionStatus?: string; DisplayText?: string; Duration?: number }
      // Silence or nothing recognisable is an empty turn, not a failure.
      if (parsed.RecognitionStatus !== "Success" && parsed.RecognitionStatus !== "NoMatch" && parsed.RecognitionStatus !== "InitialSilenceTimeout") {
        throw new Error(`transcription: ${parsed.RecognitionStatus ?? "no status"}`)
      }
      const seconds = wavSeconds(clip) ?? (parsed.Duration ? Math.round(parsed.Duration / 1e6) / 10 : 0)
      return { text: (parsed.DisplayText ?? "").replace(/\s+/g, " ").trim(), cost: seconds * price, seconds, model }
    },
  }
}

/** The recognizer takes PCM WAV (at the rate in its header) or OGG Opus. */
function contentType(clip: AudioClip, bytes: Buffer): string {
  if (clip.format === "wav") {
    const rate = bytes.length >= 28 && bytes.toString("ascii", 0, 4) === "RIFF" ? bytes.readUInt32LE(24) : 16_000
    return `audio/wav; codecs=audio/pcm; samplerate=${rate}`
  }
  if (clip.format === "ogg") return "audio/ogg; codecs=opus"
  throw new Error(`Azure speech to text takes WAV or OGG, not ${clip.format}`)
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

type Env = Record<string, string | undefined>

/** Key and region from AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (or the region in AZURE_SPEECH_ENDPOINT); null without both. */
export function azureFromEnv(env: Env = process.env): { key: string; region: string } | null {
  const key = env.AZURE_SPEECH_KEY?.trim()
  const region = env.AZURE_SPEECH_REGION?.trim() || env.AZURE_SPEECH_ENDPOINT?.match(/^https:\/\/([a-z0-9]+)\.api\.cognitive\.microsoft\.com/)?.[1]
  return key && region ? { key, region } : null
}

/** Text to speech: Azure when configured, else OpenRouter, else null (prompts show as text only). */
export function speechFromEnv(store: AudioStore, env: Env = process.env): Speech | null {
  const azure = azureFromEnv(env)
  if (!azure) return openRouterSpeechFromEnv(store)
  return azureSpeech({
    ...azure, store,
    voice: env.AZURE_SPEECH_VOICE || undefined,
    pricePerChar: env.AZURE_TTS_PRICE_PER_MILLION_CHARS ? Number(env.AZURE_TTS_PRICE_PER_MILLION_CHARS) / 1_000_000 : undefined,
  })
}

/** The ear: Azure when configured, else OpenRouter, else null (live calls cannot reach tier 2). */
export function transcriberFromEnv(env: Env = process.env): Transcriber | null {
  const azure = azureFromEnv(env)
  if (!azure) return openRouterTranscriberFromEnv(env)
  return azureTranscriber({
    ...azure,
    language: env.AZURE_SPEECH_LANGUAGE || undefined,
    pricePerSecond: env.AZURE_STT_PRICE_PER_HOUR ? Number(env.AZURE_STT_PRICE_PER_HOUR) / 3600 : undefined,
  })
}
