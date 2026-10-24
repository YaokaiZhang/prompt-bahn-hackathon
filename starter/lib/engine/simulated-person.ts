// The simulated person (ticket 10): answers background calls that nobody watches.
// A script is a list of moves per call: "answer", "decline", "no_answer" or a
// keypad digit, consumed one per callee turn. When a script runs out the person
// answers and presses 1 (yes).
//
// `simulatedPerson()` is the app's default: the demo cases have fixed scripts, and
// every other order gets a stable mix (most answer and confirm; some are busy, some
// decline or don't answer, a few report a problem), so callbacks show up on the
// demo clock without anyone at a phone. Call `n` on a line uses `scripts[ref][n-1]`.

import { bucket, type Call, type CalleeInput } from "./calls"

export type Move = "answer" | "decline" | "no_answer" | string

export type PersonReply = { input: CalleeInput; seconds: number }

export interface SimulatedPerson {
  /** The callee's next move on a call that expects one. */
  respond(call: Call): PersonReply
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

export function simulatedPerson(scripts: Scripts = DEMO_SCRIPTS): SimulatedPerson {
  return scriptedPerson(scripts, defaultMoves)
}
