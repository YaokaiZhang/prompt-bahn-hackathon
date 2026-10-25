// The simulated person (ticket 10): answers background calls that nobody watches.
// A script is a list of moves per call: "answer", "decline", "no_answer" or a
// keypad digit, consumed one per callee turn. When a script runs out the person
// answers and presses 1 (yes).
//
// `simulatedPerson()` is the app's default: the demo cases have fixed scripts, and
// every other order gets a stable mix (most answer and confirm; some are busy, some
// decline or don't answer, a few report a problem), so callbacks show up on the
// demo clock without anyone at a phone. Call `n` on a line uses `scripts[ref][n-1]`.
//
// Tier 2 (ticket 12): a person with `talk` can hold the voice agent's conversation in
// text. `modelCallee` makes a model play the callee: it stays in character and answers
// from the order's records. Without `talk` a simulated escalation ends as a handover.

import type { Bundle } from "@/lib/present/bundle"
import { bundleRecords } from "@/lib/reviewer/case-file"
import type { ChatMessage, ModelGateway } from "@/lib/reviewer/gateway"
import { renderRecord, sortRecords } from "@/lib/reviewer/records"
import { DEFAULT_REVIEWER_MODEL } from "@/lib/reviewer/reviewer"
import { bucket, type Call, type CalleeInput } from "./calls"
import { estimateSeconds } from "./speech"
import type { Heard, VoiceTurn } from "./voice-agent"

export type Move = "answer" | "decline" | "no_answer" | string

export type PersonReply = { input: CalleeInput; seconds: number }

/** What the callee says next at tier 2, as text; `error` when it could not be had (the agent hears nothing). */
export type Talked = Heard & { error?: string }

export interface SimulatedPerson {
  /** The callee's next move on a call that expects one. */
  respond(call: Call): PersonReply
  /** Tier 2: the callee's next words to the voice agent (the agent's latest is last in `history`). */
  talk?(input: { call: Call; bundle: Bundle; history: VoiceTurn[] }): Promise<Talked>
}

/** Seconds the person takes: ringing until answered, a press after the prompt ends. */
const RING_SECONDS: Record<string, number> = { answer: 6, decline: 8, no_answer: 30 }
const PRESS_SECONDS = 2

export type Scripts = Record<string, Move[][]>

/** The demo cases' scripts (spec journeys). */
export const DEMO_SCRIPTS: Scripts = {
  // J3: "Still on track? Press 1." Ends without a person.
  "CD-420806": [["answer", "1", "1"]],
  // J2: the site's stock control holds the keys (msg-x5d8006558b9e7cc6 says reception does not).
  "CD-420516": [["answer", "1", "3"], ["answer", "1", "1"]],
}

function callNumber(call: Call): number {
  const match = /-(\d+)$/.exec(call.id)
  return match ? Number(match[1]) : 1
}

function moveToInput(move: Move | undefined, call: Call): CalleeInput {
  if (call.expecting?.type === "ring") {
    if (move === "decline") return { type: "decline" }
    if (move === "no_answer") return { type: "no_answer" }
    return { type: "answer" }
  }
  return { type: "key", digit: move && /^[0-9*#]$/.test(move) ? move : "1" }
}

export function scriptedPerson(scripts: Scripts, fallback?: (call: Call) => Move[]): SimulatedPerson {
  return {
    respond(call) {
      const script = scripts[call.reference]?.[callNumber(call) - 1] ?? fallback?.(call) ?? []
      const position = call.answers.length + (call.state === "ringing" ? 0 : 1)
      const move = script[position]
      const input = moveToInput(move, call)
      const seconds = input.type === "key" ? PRESS_SECONDS : RING_SECONDS[input.type === "answer" ? "answer" : input.type]
      return { input, seconds }
    },
  }
}

/** A stable mix of behaviours for orders without a script. */
export function defaultMoves(call: Call): Move[] {
  if (call.attempt > 1) return ["answer", "1"]
  switch (bucket(`${call.reference}:${call.line}`, 10)) {
    case 0: return ["no_answer"]
    case 1: return ["decline"]
    case 2: return ["answer", "2", "1"]
    case 3: return ["answer", "1", "2"]
    default: return ["answer", "1"]
  }
}

/** The app's person: the scripts and the stable mix; with `talk` (e.g. `modelCallee`) it holds tier 2 too. */
export function simulatedPerson(scripts: Scripts = DEMO_SCRIPTS, talk?: SimulatedPerson["talk"]): SimulatedPerson {
  return { ...scriptedPerson(scripts, defaultMoves), ...(talk ? { talk } : {}) }
}

/**
 * Records the callee plausibly knows: not the support inbox or the customer's account.
 * The callee answers like the person would, not like the reviewer.
 */
const CALLEE_DROPS = new Set(["inbox_thread", "customer"])

/** The callee played by a model (Haiku through the reviewer's gateway), in text. */
export function modelCallee(gateway: ModelGateway, model = DEFAULT_REVIEWER_MODEL): NonNullable<SimulatedPerson["talk"]> {
  return async ({ call, bundle, history }) => {
    try {
      const response = await gateway.chat({ job: "call-callee", subject: call.reference, model, effort: "none", maxTokens: 200, messages: calleeMessages(call, bundle, history) })
      // Stage directions ("*sighs*") slip through now and then: nobody says them on the phone.
      const text = (response.message.content ?? "").replace(/\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim()
      if (!text) throw new Error("The simulated callee said nothing")
      return { text, cost: response.usage.cost, seconds: estimateSeconds(text), model: response.model }
    } catch (error) {
      return { text: "", cost: 0, seconds: 0, model, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

function calleeMessages(call: Call, bundle: Bundle, history: VoiceTurn[]): ChatMessage[] {
  const name = call.callee.name ? call.callee.name.split(",")[0] : call.callee.handle
  const role = call.line === "driver" ? "the driver delivering this car" : `the contact at the pickup site${call.callee.role ? ` (${call.callee.role})` : ""}`
  const keypad = call.transcript.filter((line) => line.tier === 1 && line.by !== "system").map((line) => `${line.by === "agent" ? "Assistant" : "You"}: ${line.text}`)
  const escalation = call.transcript.find((line) => line.by === "system" && line.text.startsWith("Moved to tier 2: "))?.text.slice("Moved to tier 2: ".length)
  const records = sortRecords(bundleRecords(bundle, call.zone).filter((record) => !CALLEE_DROPS.has(record.kind))).map(renderRecord)
  const persona = [
    `You play ${name}, ${role}, on order ${call.reference}${call.car ? ` (a ${call.car})` : ""}. The car delivery control room's voice assistant is on the phone with you. This is a simulation: stay in character as a real, busy person on the phone and never mention being simulated.`,
    "The call so far, on the keypad:", ...keypad,
    `The call moved to a conversation because: ${escalation ?? "your keypad answer needs a conversation"}`,
    "How you answer: one to three short spoken sentences, plain English, no lists, no stage directions. Answer the question you are asked, consistently with your keypad answers.",
    `Answer from the order's records below; times are your local time (${call.zone}). Where the records say nothing, give an ordinary, plausible detail that fits them and never contradicts them. Do not invent dramatic events.`,
    "If you have nothing more to add, say so briefly. You cannot change the customer's delivery promise yourself.",
  ].join("\n")
  return [
    // The records are the same every turn: cached after the first.
    { role: "system", content: [{ type: "text", text: persona }, { type: "text", text: `The order's records:\n${records.join("\n")}`, cache_control: { type: "ephemeral" } }] },
    // The assistant is the other party: its words are the user turns, the callee's are ours.
    ...history.map((turn): ChatMessage => turn.by === "agent" ? { role: "user", content: turn.text } : { role: "assistant", content: turn.text }),
  ]
}
