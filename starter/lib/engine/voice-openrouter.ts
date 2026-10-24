// OpenRouter adapters for the tier-2 voice agent (ticket 12).
//
// - `openRouterVoice`: the audio-in, audio-out model on /chat/completions. The callee's
//   recording goes in as an `input_audio` part; audio output requires streaming, so
//   the reply arrives as `delta.audio` chunks (base64 PCM16, 24 kHz mono, plus its
//   transcript), which are joined, wrapped as WAV and stored in the AudioStore.
//   The spec names `openai/gpt-4o-audio-preview`; OpenRouter lists `openai/gpt-audio`
//   and `openai/gpt-audio-mini` (October 2026). Default: the mini one (about $0.0006
//   a turn). Override with TIER2_AUDIO_MODEL; `off` forces the fallback.
// - `openRouterTranscriber`: /audio/transcriptions with base64 JSON, the ear for both
//   paths (the transcript line, and the fallback's input). Default whisper-large-v3.

import { createHash } from "node:crypto"
import type { AudioStore } from "./speech"
import type { AudioClip, Heard, Transcriber, VoiceModel, VoiceReply } from "./voice-agent"
import { VOICE_POLICY } from "./voice-agent"
import { pcm16ToWav, wavSeconds } from "./voice-audio"

export const DEFAULT_AUDIO_MODEL = "openai/gpt-audio-mini"
export const DEFAULT_AUDIO_VOICE = "alloy"
export const DEFAULT_TRANSCRIBE_MODEL = "openai/whisper-large-v3"
const BASE = "https://openrouter.ai/api/v1"
const PCM_RATE = 24_000

type Options = { apiKey: string; model?: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }

export function openRouterTranscriber(options: Options): Transcriber {
  const model = options.model ?? DEFAULT_TRANSCRIBE_MODEL
  const doFetch = options.fetch ?? fetch
  return {
    async transcribe(clip: AudioClip): Promise<Heard> {
      const response = await doFetch(`${options.baseUrl ?? BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input_audio: { data: clip.data, format: clip.format }, language: "en" }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      })
      const body = await response.text()
      if (!response.ok) throw new Error(`transcription ${response.status}: ${body.slice(0, 200)}`)
      const parsed = JSON.parse(body) as { text?: string; usage?: { seconds?: number; cost?: number } }
      return {
        text: (parsed.text ?? "").replace(/\s+/g, " ").trim(),
        cost: parsed.usage?.cost ?? 0,
        seconds: parsed.usage?.seconds ?? wavSeconds(clip) ?? 0,
        model,
      }
    },
  }
}

export function openRouterVoice(options: Options & { store: AudioStore; voice?: string }): VoiceModel {
  const model = options.model ?? DEFAULT_AUDIO_MODEL
  const voice = options.voice ?? DEFAULT_AUDIO_VOICE
  const doFetch = options.fetch ?? fetch
  return {
    async reply({ brief, history, clip }): Promise<VoiceReply> {
      const response = await doFetch(`${options.baseUrl ?? BASE}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model, stream: true, modalities: ["text", "audio"], audio: { voice, format: "pcm16" }, usage: { include: true }, max_tokens: 400,
          messages: [
            { role: "system", content: `${brief}\n\nHow you speak:\n${VOICE_POLICY}` },
            ...history.map((turn) => ({ role: turn.by === "agent" ? "assistant" : "user", content: turn.text })),
            { role: "user", content: [{ type: "input_audio", input_audio: { data: clip.data, format: clip.format } }] },
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      })
      if (!response.ok || !response.body) throw new Error(`audio model ${response.status}: ${(await response.text()).slice(0, 200)}`)
      const chunks: Buffer[] = []
      let transcript = ""
      let cost = 0
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (!data || data === "[DONE]") continue
          const event = JSON.parse(data) as { error?: { message?: string }; usage?: { cost?: number }; choices?: { delta?: { audio?: { data?: string; transcript?: string } } }[] }
          if (event.error) throw new Error(`audio model: ${event.error.message ?? "error"}`)
          if (event.usage?.cost) cost = event.usage.cost
          const audio = event.choices?.[0]?.delta?.audio
          if (audio?.data) chunks.push(Buffer.from(audio.data, "base64"))
          if (audio?.transcript) transcript += audio.transcript
        }
      }
      const pcm = Buffer.concat(chunks)
      const text = transcript.trim()
      if (!pcm.length || !text) throw new Error("audio model: no audio in the reply")
      const bytes = pcm16ToWav(pcm, PCM_RATE)
      const seconds = Math.round((pcm.length / (PCM_RATE * 2)) * 10) / 10
      const audioId = createHash("sha256").update(bytes).digest("hex").slice(0, 32)
      await options.store.put(audioId, { bytes, contentType: "audio/wav", seconds, model, text })
      return { text, audioId, seconds, cost, model }
    },
  }
}

/** The audio model from the environment: null when it is switched off (TIER2_AUDIO_MODEL=off) or there is no key. */
export function openRouterVoiceFromEnv(store: AudioStore, env: Record<string, string | undefined> = process.env): VoiceModel | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  if (!apiKey || env.TIER2_AUDIO_MODEL === "off") return null
  return openRouterVoice({ apiKey, store, model: env.TIER2_AUDIO_MODEL || undefined, voice: env.TIER2_AUDIO_VOICE || undefined })
}

export function openRouterTranscriberFromEnv(env: Record<string, string | undefined> = process.env): Transcriber | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return null
  return openRouterTranscriber({ apiKey, model: env.TRANSCRIBE_MODEL || undefined })
}
