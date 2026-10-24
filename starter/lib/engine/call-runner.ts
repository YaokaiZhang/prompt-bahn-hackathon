// The call runner (ticket 10): starts calls for lines that need one and takes the
// agent's and the simulated person's turns. The engine owns it; the app pumps it
// (`runCalls` with `steps: 1` every second or so), tests run it until quiet.
//
// Who answers: `answererFor(header)` decides when a call starts. "simulated" calls
// are answered here by the `SimulatedPerson`; "live" calls wait for the phone page
// (ticket 11) to send `callEvent` commands, and the agent answers each at once.
// Live calls ring on a persona's phone (ticket 11, phone.ts): one at a time per
// phone, the rest queued; each round also rings out a live call that rang
// `ringTimeoutMs` on an open phone ("no answer", so the agent schedules a callback).
// Tier 2 (ticket 12): set `tier2: true` and take the call's turns while it is in
// state "tier2"; the runner leaves such calls alone.

import type { Bundle } from "@/lib/present/bundle"
import {
  agentTurn, calleeEvent, DEFAULT_RATES, foldCall, newCallHeader, refuseInput,
  type Answerer, type Call, type CalleeInput, type CallHeader, type CostRates, type OrderCalls, type StoredCallEvent,
} from "./calls"
import { simulatedPerson, type SimulatedPerson } from "./simulated-person"
import type { Speech } from "./speech"
import { estimateSeconds } from "./speech"
import type { EngineStore } from "./store"
import { phoneView, queuedBehind, type PhonePersona, type PhoneView } from "./phone"

export type CallOptions = {
  /** Who answers background calls. Default: the demo scripts plus a stable mix. */
  person?: SimulatedPerson
  /** Text to speech for the agent's prompts; null or absent: text only (estimated durations). */
  speech?: Speech | null
  /** Decides, when a call starts, whether the simulated person or a live phone answers. Default: simulated. */
  answererFor?: (header: Omit<CallHeader, "answerer">) => Answerer
  /** A voice agent can take tier 2 (ticket 12). Without it an escalation ends the call as a handover. */
  tier2?: boolean
  rates?: Partial<CostRates>
  /**
   * 0 (default): the simulated person answers at once (tests, scripts). 1: it waits
   * as long as the phone would (each prompt's audio, ringing), so the control room
   * can watch the call. The app uses 1.
   */
  pace?: number
  /** Real time, ms. */
  wallClock?: () => number
  /**
   * When each persona's phone page opened (real ms), or null while none is open (ticket 11).
   * A live call rings out as "no answer" only while its phone is open. Default: always open.
   */
  phoneOpenSince?: (persona: PhonePersona) => number | null
  /** How long a live call rings on an open phone before it rings out (ms). Default RING_TIMEOUT_MS. */
  ringTimeoutMs?: number
}

export type CallRunnerDeps = {
  store: EngineStore
  bundles: Map<string, Bundle>
  options: CallOptions
  /** The demo clock. */
  clock: () => Promise<string>
  /** Every order's call lines as of `now` (from the engine's read). */
  linesAt: (now: string) => Promise<OrderCalls[]>
  /** A call just ended: record its results (proposals answered, changes proposed). */
  ended: (call: Call) => Promise<void>
}

export type CallRunner = {
  rates: CostRates
  /** Every call, folded, grouped by order (oldest first). */
  read(): Promise<Map<string, Call[]>>
  /** Runs up to `steps` rounds (default: until nothing changes). True when anything happened. */
  run(steps?: number): Promise<boolean>
  start(orderId: string, line: "site" | "driver", answerer?: Answerer): Promise<Call>
  input(callId: string, input: CalleeInput): Promise<Call>
  /** A persona's mock phone: the live call on it, the queue behind it (ticket 11). */
  phone(persona: PhonePersona): Promise<PhoneView>
}

const MAX_ROUNDS = 200

export function createCallRunner(deps: CallRunnerDeps): CallRunner {
  const { store, options } = deps
  const rates: CostRates = { ...DEFAULT_RATES, ...options.rates }
  const person = options.person ?? simulatedPerson()
  const speech = options.speech ?? null
  const wall = options.wallClock ?? (() => Date.now())
  const pace = options.pace ?? 0
  const answererFor = options.answererFor ?? (() => "simulated" as const)
  const openSince = options.phoneOpenSince ?? (() => 0)

  async function eventsByCall(): Promise<Map<string, StoredCallEvent[]>> {
    const out = new Map<string, StoredCallEvent[]>()
    for (const event of await store.readCallEvents()) {
      const list = out.get(event.callId) ?? []
      list.push(event)
      out.set(event.callId, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.seq - b.seq)
    return out
  }

  async function read(): Promise<Map<string, Call[]>> {
    const out = new Map<string, Call[]>()
    for (const events of (await eventsByCall()).values()) {
      const call = foldCall(events, rates)
      const list = out.get(call.orderId) ?? []
      list.push(call)
      out.set(call.orderId, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id, undefined, { numeric: true }))
    return out
  }

  const iso = (ms: number) => new Date(ms).toISOString()

  /** The agent's turn: what it says (with speech) and does, appended as one step. */
  async function agentStep(events: StoredCallEvent[]): Promise<boolean> {
    const call = foldCall(events, rates)
    const now = await deps.clock()
    const steps = agentTurn(call, now, options.tier2 ?? false, events[events.length - 1])
    if (!steps.length) return false
    const base = { callId: call.id, orderId: call.orderId, at: now, wallAt: iso(wall()), by: "agent" as const }
    const out: StoredCallEvent[] = []
    let seq = events.length
    for (const step of steps) {
      if (step.kind === "said") {
        const spoken = speech ? await speech.speak(step.text) : null
        out.push({ ...base, seq: seq++, kind: "said", text: step.text, data: {
          ...(step.ask ? { ask: step.ask } : {}), audioId: spoken?.audioId ?? null, seconds: spoken?.seconds ?? estimateSeconds(step.text),
          cost: spoken?.cost ?? 0, cached: spoken?.cached ?? false,
        } })
      } else if (step.kind === "tier") {
        out.push({ ...base, seq: seq++, kind: "tier", text: step.text, data: { tier: step.tier } })
      } else if (step.kind === "callback") {
        out.push({ ...base, seq: seq++, kind: "callback", text: step.text, data: { callbackAt: step.callbackAt } })
      } else {
        out.push({ ...base, seq: seq++, kind: "ended", text: step.text, data: { outcome: step.outcome, summary: step.summary, claims: step.claims, changes: step.changes } })
      }
    }
    if (!(await store.appendCallEvents(out))) return false
    if (out.some((event) => event.kind === "ended")) await deps.ended(foldCall([...events, ...out], rates))
    return true
  }

  async function calleeStep(events: StoredCallEvent[], input: CalleeInput, seconds: number): Promise<boolean> {
    const call = foldCall(events, rates)
    const refused = refuseInput(call, input)
    if (refused) throw new Error(refused)
    const event = calleeEvent(call, input, { callId: call.id, orderId: call.orderId, seq: events.length, at: await deps.clock(), wallAt: iso(wall()) }, seconds)
    if (!(await store.appendCallEvents([event]))) return false
    await agentStep([...events, event])
    return true
  }

  async function startLine(bundle: Bundle, header: CallHeader): Promise<boolean> {
    const event: StoredCallEvent = {
      callId: header.callId, orderId: header.orderId, seq: 0, at: await deps.clock(), wallAt: iso(wall()), by: "agent", kind: "started",
      text: `${header.answerer === "live" ? "Ringing live" : "Calling"} ${header.callee.name ?? header.callee.handle} (${header.callee.handle}) about ${bundle.order.reference}.`,
      data: { header, seconds: 0 },
    }
    return store.appendCallEvents([event])
  }

  async function phone(persona: PhonePersona): Promise<PhoneView> {
    return phoneView([...(await read()).values()].flat(), persona, { openSince: openSince(persona), ringTimeoutMs: options.ringTimeoutMs })
  }

  /** A live call that rang out on an open phone: "no answer" (the agent schedules the callback). */
  async function expireRings(): Promise<boolean> {
    let changed = false
    for (const persona of ["site", "driver"] as const) {
      const view = await phone(persona)
      if (!view.current || !view.ringsOutAt || wall() < new Date(view.ringsOutAt).getTime()) continue
      const events = (await eventsByCall()).get(view.current.id)
      if (!events) continue
      const seconds = (wall() - new Date(view.ringingSince ?? view.current.lastWallAt).getTime()) / 1000
      if (await calleeStep(events, { type: "no_answer" }, Math.round(Math.min(120, seconds) * 10) / 10)) changed = true
    }
    return changed
  }

  async function round(): Promise<boolean> {
    let changed = await expireRings()
    const now = await deps.clock()
    const calls = await read()
    for (const order of await deps.linesAt(now)) {
      for (const line of order.lines) {
        if ((line.status !== "to_call" && line.status !== "callback_due") || !line.callee) continue
        const bundle = deps.bundles.get(order.orderId)
        if (!bundle) continue
        if (await startLine(bundle, newCallHeader(bundle, line, calls.get(bundle.order.id) ?? [], answererFor))) changed = true
      }
    }
    // Calls are independent: take their turns side by side, so one slow prompt holds up no other call.
    const steps = [...(await eventsByCall()).values()].map(async (events) => {
      const call = foldCall(events, rates)
      if (call.state === "ended" || call.state === "tier2") return false
      if (!call.expecting) return agentStep(events)
      if (call.answerer !== "simulated") return false
      const reply = person.respond(call)
      const wait = (call.expecting.type === "ring" ? reply.seconds : call.lastSeconds) * 1000 * pace
      if (wall() < new Date(call.lastWallAt).getTime() + wait) return false
      return calleeStep(events, reply.input, reply.seconds)
    })
    return (await Promise.all(steps)).some(Boolean) || changed
  }

  // One runner step at a time in this process; (callId, seq) keeps processes apart.
  let queue: Promise<unknown> = Promise.resolve()
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work)
    queue = run.catch(() => {})
    return run
  }

  return {
    rates,
    read,
    run: (steps) => serial(async () => {
      let any = false
      for (let i = 0; i < (steps ?? MAX_ROUNDS); i++) {
        if (!(await round())) break
        any = true
      }
      return any
    }),
    start: (orderId, lineName, answerer) => serial(async () => {
      const bundle = deps.bundles.get(orderId)
      if (!bundle) throw new Error(`Unknown order ${orderId}`)
      const order = (await deps.linesAt(await deps.clock())).find((row) => row.orderId === orderId)
      const line = order?.lines.find((row) => row.line === lineName)
      if (!line || !line.callee) throw new Error(`${bundle.order.reference}: nothing to call the ${lineName} about`)
      if (line.status === "calling") throw new Error(`${bundle.order.reference}: a ${lineName} call is already running`)
      if (!line.open.length && line.status !== "callback" && line.status !== "callback_due") throw new Error(`${bundle.order.reference}: nothing left to ask the ${lineName}`)
      const header = newCallHeader(bundle, line, (await read()).get(orderId) ?? [], (base) => answerer ?? answererFor(base))
      if (!(await startLine(bundle, header))) throw new Error(`${header.callId} was started by someone else`)
      return (await read()).get(orderId)!.find((call) => call.id === header.callId)!
    }),
    input: (callId, input) => serial(async () => {
      const events = (await eventsByCall()).get(callId)
      if (!events) throw new Error(`No call ${callId}`)
      const call = foldCall(events, rates)
      const behind = queuedBehind([...(await read()).values()].flat(), call)
      if (behind) throw new Error(behind)
      const seconds = Math.min(120, Math.max(0, (wall() - new Date(call.lastWallAt).getTime()) / 1000))
      await calleeStep(events, input, Math.round(seconds * 10) / 10)
      return foldCall((await eventsByCall()).get(callId)!, rates)
    }),
    phone,
  }
}
