// Test doubles for calls: a scripted person (re-exported), speech without network,
// and the tier-2 voice agent's parts (ticket 12): the audio model, the ear and the
// checker, all scripted.

import { NO_USAGE, type ChatRequest, type ModelGateway } from "@/lib/reviewer/gateway"
import { estimateSeconds, type Speech } from "./speech"
import type { AudioClip, Heard, Transcriber, TurnCheck, VoiceModel, VoiceReply } from "./voice-agent"
import { wavSeconds } from "./voice-audio"

export { scriptedPerson } from "./simulated-person"

/**
 * A fake model gateway for the whole simulated tier 2: per job ("call-opener",
 * "call-callee", "call-check") it replies with the next scripted content, $0.001 a
 * reply. A job that runs out of replies fails, like a provider error.
 */
export function jobGateway(replies: Record<string, string[]>): ModelGateway & { readonly calls: ChatRequest[] } {
  const calls: ChatRequest[] = []
  const used = new Map<string, number>()
  return {
    calls,
    async chat(request) {
      calls.push(request)
      const index = used.get(request.job) ?? 0
      used.set(request.job, index + 1)
      const content = replies[request.job]?.[index]
      if (content === undefined) throw new Error(`no scripted ${request.job} reply ${index + 1}`)
      return { model: `fake-${request.job}`, finishReason: "stop", usage: { ...NO_USAGE, promptTokens: 1000, completionTokens: 50, cost: 0.001 }, message: { role: "assistant", content } }
    },
  }
}

/** A checker reply as the gateway returns it (JSON), with safe defaults for missing fields. */
export function checkJson(check: Partial<TurnCheck>): string {
  return JSON.stringify({
    heard: "", claims: [], changes: [], conflicts: [], replyOk: null, replyIssue: null, reply: "Thank you. Anything else I should know?",
    next: "continue", openQuestion: null, nextStep: null, summary: "Talking.", ...check,
  })
}

export type ScriptedSpeech = Speech & { readonly spoken: string[] }

/**
 * Speech for tests: every new text "costs" $0.00001 per character and gets an id;
 * repeating a text is a cache hit (cost 0), like the real cache.
 */
export function scriptedSpeech(): ScriptedSpeech {
  const seen = new Map<string, string>()
  const spoken: string[] = []
  return {
    spoken,
    async speak(text) {
      spoken.push(text)
      const known = seen.get(text)
      if (known) return { audioId: known, seconds: estimateSeconds(text), cost: 0, cached: true, model: "scripted" }
      const id = `a${String(seen.size + 1).padStart(8, "0")}`
      seen.set(text, id)
      return { audioId: id, seconds: estimateSeconds(text), cost: text.length * 0.00001, cached: false, model: "scripted" }
    },
  }
}

/** A recording of `seconds` of silence as a 16 kHz mono WAV clip (what the phone page sends). */
export function testClip(seconds = 2): AudioClip {
  const samples = Math.round(16_000 * seconds)
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write("WAVE", 8)
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40)
  return { data: bytes.toString("base64"), format: "wav" }
}

/** The ear: returns `texts` in order, $0.00005 a clip. */
export function scriptedEar(texts: string[]): Transcriber & { readonly heard: AudioClip[] } {
  const heard: AudioClip[] = []
  return {
    heard,
    async transcribe(clip): Promise<Heard> {
      heard.push(clip)
      return { text: texts[heard.length - 1] ?? "", cost: 0.00005, seconds: wavSeconds(clip) ?? 2, model: "scripted-ear" }
    },
  }
}

/** The audio model: answers with `replies` in order ($0.0006 a turn), or fails every turn with `fail`. */
export function scriptedVoice(replies: string[], fail?: string): VoiceModel & { readonly requests: Parameters<VoiceModel["reply"]>[0][] } {
  const requests: Parameters<VoiceModel["reply"]>[0][] = []
  return {
    requests,
    async reply(input): Promise<VoiceReply> {
      requests.push(input)
      if (fail) throw new Error(fail)
      const text = replies[requests.length - 1] ?? "Could you say more?"
      return { text, audioId: `v${String(requests.length).padStart(8, "0")}`, seconds: estimateSeconds(text), cost: 0.0006, model: "scripted-voice" }
    },
  }
}

/** What the scripted checker's model writes as the tier-2 opener (job "call-opener"), $0.0005 each. */
export const SCRIPTED_OPENER = "About order {ref}: you told me there is a problem on the keypad. What exactly is holding you up?"

/**
 * The checker (Haiku): replies with `checks` in order as JSON, $0.001 a turn. Missing
 * fields get safe defaults. The opener (same gateway, job "call-opener") is answered
 * with `opener` ({ref} filled in) and kept apart in `openers`, so it uses up no check.
 */
export function scriptedChecker(checks: Partial<TurnCheck>[], opener = SCRIPTED_OPENER): ModelGateway & { readonly calls: ChatRequest[]; readonly openers: ChatRequest[] } {
  const calls: ChatRequest[] = []
  const openers: ChatRequest[] = []
  return {
    calls,
    openers,
    async chat(request) {
      if (request.job === "call-opener") {
        openers.push(request)
        return { model: "scripted-checker", finishReason: "stop", usage: { ...NO_USAGE, promptTokens: 400, completionTokens: 40, cost: 0.0005 }, message: { role: "assistant", content: opener.replace("{ref}", request.subject) } }
      }
      calls.push(request)
      const check = checks[calls.length - 1] ?? {}
      const content = JSON.stringify({
        heard: "", claims: [], changes: [], conflicts: [], replyOk: true, replyIssue: null, reply: "Thank you. Anything else I should know?",
        next: "continue", openQuestion: null, nextStep: null, summary: "Talking.", ...check,
      })
      return { model: "scripted-checker", finishReason: "stop", usage: { ...NO_USAGE, promptTokens: 900, completionTokens: 150, cost: 0.001 }, message: { role: "assistant", content } }
    },
  }
}
