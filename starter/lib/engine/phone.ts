// The mock phone (ticket 11): which calls ring live, on whose phone, and in what order.
//
// - Routing: `demoAnswerer()` is the app's `CallOptions.answererFor`. The demo cases'
//   lines ring live (CD-420516's site call about the keys, the CD-420806 and CD-420437
//   driver calls); every other call is answered by the simulated person. The operator
//   rings any other call live with `startCall { live: true }` ("Ring live").
// - Phones: a site line rings the Site persona's phone, a driver line the Driver's.
// - Queue: each phone takes one live call at a time. The oldest unfinished live call
//   is on the phone; the rest wait (`queued`) and cannot be answered yet.
// - Ring timeout: a call on the phone that rings `ringTimeoutMs` (real time) while the
//   phone page is open rings out as "no answer" (the runner applies it). The ring
//   counts from when the call reached the phone: started, the call before it ended,
//   or the phone page opened, whichever is latest.

import type { Answerer, Call, CallHeader, CallLine } from "./calls"

export type PhonePersona = "site" | "driver"

/** The phone a line rings on. */
export const phoneFor = (line: CallLine): PhonePersona => line

/** Demo lines that ring live (spec journeys J2, J3 and story 71). */
export const DEMO_LIVE_LINES: Record<string, CallLine[]> = {
  "CD-420516": ["site"],
  "CD-420806": ["driver"],
  "CD-420437": ["driver"],
}

/** `answererFor`: live for the demo lines, simulated otherwise. */
export function demoAnswerer(lines: Record<string, CallLine[]> = DEMO_LIVE_LINES): (header: Omit<CallHeader, "answerer">) => Answerer {
  return (header) => lines[header.reference]?.includes(header.line) ? "live" : "simulated"
}

/** Default ring timeout: about six rings. */
export const RING_TIMEOUT_MS = 30_000

/** A queued live call, as the phone shows it. */
export type QueuedCall = { id: string; reference: string; line: CallLine; callee: Call["callee"]; reason: string; startedWallAt: string }

export type PhoneView = {
  persona: PhonePersona
  /** The live call on this phone (ringing, or being answered), or null. */
  current: Call | null
  /** Real time the current call started ringing on this phone (ISO), if it is ringing. */
  ringingSince: string | null
  /** Real time it rings out as "no answer" (ISO), if it is ringing and the phone is open. */
  ringsOutAt: string | null
  /** Live calls waiting for this phone, oldest first. */
  queued: QueuedCall[]
  /** The phone's latest finished live call, for the "call ended" screen. */
  last: Call | null
}

const startWall = (call: Call) => call.transcript[0]?.wallAt ?? call.lastWallAt

/** Live calls for a persona's phone, oldest first. */
function liveCalls(calls: Call[], persona: PhonePersona): Call[] {
  return calls
    .filter((call) => call.answerer === "live" && phoneFor(call.line) === persona)
    .sort((a, b) => startWall(a).localeCompare(startWall(b)) || a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/**
 * Pure: a persona's phone from every call. `openSince` is when the phone page opened
 * (real ms), or null when no phone page is open (nothing rings out then).
 */
export function phoneView(calls: Call[], persona: PhonePersona, options: { openSince: number | null; ringTimeoutMs?: number }): PhoneView {
  const live = liveCalls(calls, persona)
  const open = live.filter((call) => call.state !== "ended")
  const [current = null, ...rest] = open
  const ended = live.filter((call) => call.state === "ended").sort((a, b) => a.lastWallAt.localeCompare(b.lastWallAt))
  let ringingSince: string | null = null
  let ringsOutAt: string | null = null
  if (current && current.state === "ringing") {
    const since = Math.max(
      new Date(startWall(current)).getTime(),
      ...ended.map((call) => new Date(call.lastWallAt).getTime()).filter((at) => at > new Date(startWall(current)).getTime()),
    )
    ringingSince = new Date(since).toISOString()
    if (options.openSince !== null) ringsOutAt = new Date(Math.max(since, options.openSince) + (options.ringTimeoutMs ?? RING_TIMEOUT_MS)).toISOString()
  }
  return {
    persona, current, ringingSince, ringsOutAt,
    queued: rest.map((call) => ({ id: call.id, reference: call.reference, line: call.line, callee: call.callee, reason: call.reason, startedWallAt: startWall(call) })),
    last: ended[ended.length - 1] ?? null,
  }
}

/** Why a live call cannot take the phone's input now (it waits behind another), or null. */
export function queuedBehind(calls: Call[], call: Call): string | null {
  if (call.answerer !== "live" || call.state === "ended") return null
  const head = liveCalls(calls, phoneFor(call.line)).find((row) => row.state !== "ended")
  return head && head.id !== call.id ? `${call.id} is queued behind ${head.id} on the ${phoneFor(call.line)} phone` : null
}
