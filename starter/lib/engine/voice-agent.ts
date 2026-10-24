// Tier 2, the voice agent (ticket 12). When keypad answers are not enough the call
// moves to tier 2 and the callee talks (push-to-talk on the phone page). Each turn:
//
//   1. the ear (a transcription model) writes down what the callee said, and, at the
//      same time, the audio model (audio in, audio out) answers them aloud from a short
//      brief (not the case file);
//   2. the checker (Haiku, through the ModelGateway) reads the transcript against the
//      brief's facts and the policy and writes the structured result: claims, changes
//      the callee asked for, conflicts with the records, whether the agent's reply is
//      allowed, and whether to go on, end resolved or hand over;
//   3. the agent says the audio model's reply when the checker allows it and the call
//      goes on; otherwise it says the checker's own reply through text to speech.
//
// Fallback: when the audio model fails (or none is configured), the ear listens, the
// checker decides and writes the reply, and text to speech speaks it.
//
// The voice agent gathers information only. It never agrees to a change: a change
// the callee wants becomes a change proposal (needs the operator's yes) when the call
// ends, and what they said becomes the call result (engine `callEnded`).

import type { ChatMessage, ModelGateway } from "@/lib/reviewer/gateway"
import { DEFAULT_REVIEWER_MODEL } from "@/lib/reviewer/reviewer"
import { rows, str, type Bundle } from "@/lib/present/bundle"
import { localTime, type Call, type CallChange } from "./calls"
import type { Speech } from "./speech"
import { estimateSeconds } from "./speech"

/** A recording from the phone, base64 without a data: prefix. */
export type AudioClip = { data: string; format: "wav" | "mp3" | "webm" | "ogg" | "m4a" | "flac" }

export type Heard = { text: string; cost: number; seconds: number; model: string }

/** The ear: speech to text. */
export interface Transcriber {
  transcribe(clip: AudioClip, subject: string): Promise<Heard>
}

/** One exchange so far, as text, for the audio model's context. */
export type VoiceTurn = { by: "agent" | "callee"; text: string }

export type VoiceReply = { text: string; audioId: string | null; seconds: number; cost: number; model: string }

/** The audio-in, audio-out model: answers the callee's recording aloud. */
export interface VoiceModel {
  reply(input: { brief: string; history: VoiceTurn[]; clip: AudioClip; subject: string }): Promise<VoiceReply>
}

export type TurnNext = "continue" | "resolved" | "handover"

/** The checker's structured result for one turn (shown in the transcript). */
export type TurnCheck = {
  /** What the callee said, cleaned up. */
  heard: string
  /** Facts the callee stated, as short attributed claims. */
  claims: string[]
  /** Changes the callee asked for or reported: each becomes a change proposal (needs a yes). */
  changes: CallChange[]
  /** Where what they said disagrees with the records in the brief. */
  conflicts: string[]
  /** Did the audio model's reply stay inside the policy (no promise, no agreeing to a change)? Null when there was no reply to check. */
  replyOk: boolean | null
  /** Why the reply was not allowed, when it was not. */
  replyIssue: string | null
  /** What the agent says next when the audio model's reply is not used. */
  reply: string
  next: TurnNext
  /** For a handover: the open question a person must settle, and the proposed next step (ticket 14). */
  openQuestion: string | null
  nextStep: string | null
  /** One line for the order's call summary. */
  summary: string
  /** The checker failed and this safe check stands in: it records nothing. */
  failed?: boolean
}

/** Who made the words the agent said: the audio model ("voice"), the checker because the audio model's reply was not allowed ("replaced"), or the checker because the audio model failed ("fallback"). */
export type TurnPath = "voice" | "replaced" | "fallback"

export type TurnResult = {
  heard: Heard
  check: TurnCheck
  checkCost: number
  checkModel: string
  /** The checker failed: a safe check stands in for it. */
  checkError: string | null
  path: TurnPath
  /** Why the audio model was not used, when it was not. */
  voiceError: string | null
  /** What the agent says now. */
  said: { text: string; audioId: string | null; seconds: number; cost: number; model: string | null; from: "voice" | "speech" }
}

export type VoiceAgent = {
  /** The first words at tier 2 (fixed text, so its speech is generated once). */
  opener(call: Call): string
  turn(input: { call: Call; brief: string; history: VoiceTurn[]; clip: AudioClip; speech: Speech | null; turn: number }): Promise<TurnResult>
  /** Turns a call may take before the agent hands it over. */
  maxTurns: number
}

export type VoiceAgentOptions = {
  /** The audio model; null or a failure uses the fallback. */
  voice?: VoiceModel | null
  ear: Transcriber
  /** Haiku's gateway (the reviewer's ModelGateway). */
  checker: ModelGateway
  model?: string
  maxTurns?: number
}

export const TIER2_OPENER = "I understand there is a problem. Please tell me in your own words what's happening. Hold the talk button while you speak."
const SAFE_REPLY = "Thank you. Could you tell me a little more about that?"

/** The rules every reply follows; the audio model's system prompt and the checker's policy. */
export const VOICE_POLICY = [
  "You gather information only. Never agree to, promise or confirm a change to the order (time, address, contact, receiver, cost, route).",
  "If the person asks for a change or reports one, say you have noted it and a colleague in the control room will review it.",
  "Ask one short question at a time. Two sentences at most. Plain spoken English, no lists.",
  "Never invent facts. Never discuss prices or blame.",
].join("\n")

export function createVoiceAgent(options: VoiceAgentOptions): VoiceAgent {
  const model = options.model ?? DEFAULT_REVIEWER_MODEL
  const maxTurns = options.maxTurns ?? 4
  return {
    maxTurns,
    opener: () => TIER2_OPENER,
    async turn({ call, brief, history, clip, speech, turn }) {
      const subject = call.reference
      // The ear and the audio model run side by side: the transcript does not wait for the reply.
      const [heard, voiced] = await Promise.all([
        options.ear.transcribe(clip, subject),
        options.voice
          ? options.voice.reply({ brief, history, clip, subject }).then((reply) => ({ reply, error: null }), (error: unknown) => ({ reply: null, error: message(error) }))
          : Promise.resolve({ reply: null, error: "no audio model configured" }),
      ])
      const draft = voiced.reply
      let check: TurnCheck
      let checkCost = 0
      let checkModel = model
      let checkError: string | null = null
      try {
        const response = await options.checker.chat({
          job: "call-check", subject, model, effort: "none", maxTokens: 900,
          messages: checkMessages({ brief, history, heard: heard.text, draft: draft?.text ?? null, turn, maxTurns }),
        })
        checkCost = response.usage.cost
        checkModel = response.model
        check = parseCheck(response.message.content ?? "", heard.text, draft !== null)
      } catch (error) {
        checkError = message(error)
        check = safeCheck(heard.text, draft !== null, turn >= maxTurns)
      }
      if (turn >= maxTurns && check.next === "continue") {
        check = { ...check, next: "handover", openQuestion: check.openQuestion ?? "The call ran out of turns before the problem was settled.", reply: handoverReply() }
      }
      const useVoice = draft !== null && check.replyOk === true && check.next === "continue"
      let said: TurnResult["said"]
      if (useVoice) {
        said = { ...draft, from: "voice" }
      } else {
        const text = check.reply || SAFE_REPLY
        const spoken = speech ? await speech.speak(text) : null
        said = { text, audioId: spoken?.audioId ?? null, seconds: spoken?.seconds ?? estimateSeconds(text), cost: (draft?.cost ?? 0) + (spoken?.cost ?? 0), model: spoken?.model ?? null, from: "speech" }
      }
      return { heard, check, checkCost, checkModel, checkError, path: !draft ? "fallback" : useVoice ? "voice" : "replaced", voiceError: voiced.error, said }
    },
  }
}

/**
 * The short brief the audio model and the checker read: who, why, what the keypad
 * said, and the few facts the call is about (times in the callee's zone). Not the case file.
 */
export function briefFor(bundle: Bundle, call: Call): string {
  const local = (iso: string) => `${localTime(iso, call.zone)}`
  const name = call.callee.name ? call.callee.name.split(",")[0] : call.callee.handle
  const windowOf = (purpose: string) => rows(bundle, "time_windows").find((row) => row.details.purpose === purpose && row.details.is_selected === true)
  const facts: string[] = []
  const promise = windowOf("CUSTOMER_DELIVERY_PROMISE")
  const slot = windowOf("SELECTED_PICKUP_SLOT")
  if (call.line === "driver") {
    const start = str(promise?.details.start_at)
    const end = str(promise?.details.end_at)
    if (start && end) facts.push(`Delivery promise to the customer: ${local(start)} to ${local(end)} (${call.zone}).`)
    const eta = rows(bundle, "tracking_observations").filter((row) => str(row.details.estimated_delivery_at))
      .sort((a, b) => String(a.details.observed_at ?? "").localeCompare(String(b.details.observed_at ?? ""))).pop()
    const at = str(eta?.details.estimated_delivery_at)
    if (at) facts.push(`Latest ETA on record: ${local(at)}.`)
  } else {
    const start = str(slot?.details.start_at)
    const end = str(slot?.details.end_at)
    if (start && end) facts.push(`Booked pickup slot: ${local(start)} to ${local(end)} (${call.zone}).`)
  }
  const keypad = call.transcript.filter((line) => line.tier === 1 && line.by === "callee" && line.text.startsWith("Pressed")).map((line) => line.text)
  const escalation = call.transcript.find((line) => line.by === "system" && line.text.startsWith("Moved to tier 2"))?.text
  return [
    `Order ${call.reference}${call.car ? `, a ${call.car}` : ""}.`,
    `You are the car delivery control room's assistant on the phone with ${name}, the ${call.line === "driver" ? "assigned driver" : `contact at the pickup site${call.callee.role ? ` (${call.callee.role})` : ""}`}.`,
    `Why we called (control room note, UTC times): ${call.reason}`,
    ...(keypad.length ? [`Keypad answers so far: ${keypad.join(" ")}`] : []),
    ...(escalation ? [escalation] : []),
    ...facts,
    "Goal: find out what the problem is, what it means for the delivery, and what they will do next.",
  ].join("\n")
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function handoverReply(): string {
  return "Thank you, that helps. A colleague from the control room will call you back shortly to settle this. Goodbye."
}

/** The checker's stand-in when the checker fails: record nothing, hand over after a second failure or at the turn limit. */
function safeCheck(heard: string, hadDraft: boolean, last: boolean): TurnCheck {
  return {
    failed: true, heard, claims: [], changes: [], conflicts: [], replyOk: hadDraft ? false : null, replyIssue: hadDraft ? "Not checked: the checker failed." : null,
    reply: last ? handoverReply() : SAFE_REPLY, next: last ? "handover" : "continue",
    openQuestion: last ? "The agent could not check what was said." : null, nextStep: last ? "Call the driver back and settle the problem." : null,
    summary: heard ? `Said: ${heard}` : "Nothing heard.",
  }
}

function checkMessages(input: { brief: string; history: VoiceTurn[]; heard: string; draft: string | null; turn: number; maxTurns: number }): ChatMessage[] {
  const system = [
    "You check one turn of a phone call made by the delivery control room's voice agent. You return JSON only.",
    "Policy for the agent:", VOICE_POLICY,
    "",
    "Return exactly this JSON object:",
    `{"heard": string (what the person said, cleaned up),
 "claims": string[] (ALL facts the person has stated on this call so far, merged and without repeats, short, e.g. "Expects to arrive at 16:40 local"),
 "changes": {"title": string, "change": string, "claim": string}[] (ALL changes to the order the person asked for or reported on this call so far, one per subject, e.g. a new ETA after the promise, a new address; empty if none),
 "conflicts": string[] (where the person's words disagree with the facts in the brief),
 "replyOk": boolean | null (null when there is no draft reply; false ONLY if the draft agrees to, promises or confirms a change, invents facts, discusses prices, or makes no sense after what the person said; wording and style are not reasons),
 "replyIssue": string | null,
 "reply": string (what the agent should say next, following the policy; when next is "continue" it asks one short question; when next is not "continue" it asks nothing, says what was noted and ends with "Goodbye."),
 "next": "continue" | "resolved" | "handover" ("resolved" when the agent knows what the problem is, what it means for the delivery and what the person will do, or the person has nothing more to say; a reported change such as a later ETA does NOT need a handover, it becomes a proposal for the operator; "handover" only when the person needs a decision now, asks for a person, or the situation is still unclear; if the only open matter is a change you listed, next is "resolved"),
 "openQuestion": string | null (for handover: the question a person must settle),
 "nextStep": string | null (for handover: the proposed next step for the operator),
 "summary": string (one line: what the call learned so far)}`,
    `This is turn ${input.turn} of at most ${input.maxTurns}. On the last turn, next must not be "continue".`,
  ].join("\n")
  const user = JSON.stringify({
    brief: input.brief,
    transcript_so_far: input.history,
    person_just_said: input.heard,
    agent_draft_reply: input.draft,
  }, null, 1)
  return [{ role: "system", content: system }, { role: "user", content: user }]
}

const NEXT: TurnNext[] = ["continue", "resolved", "handover"]

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((row): row is string => typeof row === "string" && !!row.trim()).map((row) => row.trim()) : []
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null

/** The checker's JSON (code fences allowed). Throws when it is not a usable check. */
export function parseCheck(content: string, heard: string, hadDraft: boolean): TurnCheck {
  const body = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error("The checker did not reply with JSON")
  const raw = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
  const next = NEXT.includes(raw.next as TurnNext) ? raw.next as TurnNext : null
  if (!next) throw new Error(`The checker's next step is not one of ${NEXT.join(", ")}`)
  const reply = text(raw.reply)
  if (!reply || reply.length > 500) throw new Error("The checker wrote no usable reply")
  const changes: CallChange[] = Array.isArray(raw.changes) ? raw.changes.flatMap((row) => {
    const item = row && typeof row === "object" ? row as Record<string, unknown> : {}
    const title = text(item.title)
    const change = text(item.change)
    return title && change ? [{ title, change, claim: text(item.claim) ?? change }] : []
  }) : []
  return {
    heard: text(raw.heard) ?? heard,
    claims: strings(raw.claims),
    changes,
    conflicts: strings(raw.conflicts),
    replyOk: hadDraft ? raw.replyOk === true : null,
    replyIssue: text(raw.replyIssue),
    reply,
    next,
    openQuestion: text(raw.openQuestion),
    nextStep: text(raw.nextStep),
    summary: text(raw.summary) ?? (text(raw.heard) ?? heard),
  }
}
