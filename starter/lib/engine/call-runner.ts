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
// Tier 2 (ticket 12): with a `voice` agent, an escalation moves the call to state
// "tier2" and the agent opens (what it knows, one question). On a live call each
// `voice(callId, clip)` is then one turn (the callee's recording in, the agent's reply
// out); the round leaves live tier-2 calls alone. On a simulated call the round takes
// the turns: the person's `talk` (a model playing the callee) says the next words in
// text, and the same voice agent checks and answers them, without any audio. A
// simulated person without `talk` cannot talk: its escalations end as a handover.

import type { Bundle } from "@/lib/present/bundle"
import {
  agentTurn, calleeEvent, DEFAULT_RATES, foldCall, newCallHeader, promptsFor, refuseInput, tier2Said,
  type Answerer, type Call, type CalleeInput, type CallHeader, type CostRates, type OrderCalls, type StoredCallEvent,
} from "./calls"
import { simulatedPerson, type SimulatedPerson, type Talked } from "./simulated-person"
import type { Speech } from "./speech"
import { estimateSeconds } from "./speech"
import { briefFor, type AudioClip, type TurnResult, type VoiceAgent, type VoiceTurn } from "./voice-agent"
import type { EngineStore } from "./store"
import { phoneView, queuedBehind, type PhonePersona, type PhoneView } from "./phone"

export type CallOptions = {
  /** Who answers background calls. Default: the demo scripts plus a stable mix. */
  person?: SimulatedPerson
  /** Text to speech for the agent's prompts; null or absent: text only (estimated durations). */
  speech?: Speech | null
  /** Decides, when a call starts, whether the simulated person or a live phone answers. Default: simulated. */
  answererFor?: (header: Omit<CallHeader, "answerer">) => Answerer
  /** The voice agent that takes calls at tier 2 (ticket 12): live ones, and simulated ones whose person can `talk`. Without it an escalation ends the call as a handover. */
  voice?: VoiceAgent | null
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
  /** A tier-2 turn: the callee's recording (push-to-talk); the voice agent answers. */
  voice(callId: string, clip: AudioClip): Promise<Call>
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
    const steps = agentTurn(call, now, canTalk(call), events[events.length - 1])
    if (!steps.length) return false
    const base = { callId: call.id, orderId: call.orderId, at: now, wallAt: iso(wall()), by: "agent" as const }
    const out: StoredCallEvent[] = []
    let seq = events.length
    let tier = call.tier
    for (const step of steps) {
      // A simulated call's tier 2 is text only: nobody listens, so nothing is spoken.
      const voiced = tier < 2 || call.answerer === "live" ? speech : null
      if (step.kind === "opener") {
        // Written now, from the call with its escalation logged: the brief says why it moved to tier 2.
        const sofar = foldCall([...events, ...out], rates)
        const bundle = deps.bundles.get(call.orderId)
        if (!bundle || !options.voice) throw new Error(`No voice agent to open ${call.id}`)
        const opened = await options.voice.opener({ call: sofar, brief: briefFor(bundle, sofar) })
        const spoken = voiced ? await voiced.speak(opened.text) : null
        out.push({ ...base, seq: seq++, kind: "said", text: opened.text, data: {
          audioId: spoken?.audioId ?? null, seconds: spoken?.seconds ?? estimateSeconds(opened.text), cost: opened.cost + (spoken?.cost ?? 0),
          cached: spoken?.cached ?? false, model: opened.model, error: opened.error,
        } })
      } else if (step.kind === "said") {
        const spoken = voiced ? await voiced.speak(step.text) : null
        out.push({ ...base, seq: seq++, kind: "said", text: step.text, data: {
          ...(step.ask ? { ask: step.ask } : {}), audioId: spoken?.audioId ?? null, seconds: spoken?.seconds ?? estimateSeconds(step.text),
          cost: spoken?.cost ?? 0, cached: spoken?.cached ?? false,
        } })
      } else if (step.kind === "tier") {
        tier = step.tier
        out.push({ ...base, seq: seq++, kind: "tier", text: step.text, data: { tier: step.tier } })
      } else if (step.kind === "callback") {
        out.push({ ...base, seq: seq++, kind: "callback", text: step.text, data: { callbackAt: step.callbackAt } })
      } else {
        out.push({ ...base, seq: seq++, kind: "ended", text: step.text, data: {
          outcome: step.outcome, summary: step.summary, claims: step.claims, changes: step.changes, ...(step.handover ? { handover: step.handover } : {}),
        } })
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

  /** Can the voice agent take this call at tier 2: a live callee, or a simulated one who can talk. */
  function canTalk(call: Call): boolean {
    return !!options.voice && (call.answerer === "live" || !!person.talk)
  }

  /**
   * One tier-2 turn, stored as heard -> checked -> said (-> ended). A clip comes from the
   * phone page; text from the simulated callee (no ear, no audio model, no speech).
   */
  async function voiceStep(events: StoredCallEvent[], input: { clip: AudioClip } | { text: Talked }): Promise<void> {
    const agent = options.voice
    if (!agent) throw new Error("No voice agent takes tier 2")
    const call = foldCall(events, rates)
    if (call.state !== "tier2" || call.expecting?.type !== "speech") throw new Error(`${call.id} is not listening for speech`)
    const bundle = deps.bundles.get(call.orderId)
    if (!bundle) throw new Error(`Unknown order ${call.orderId}`)
    const history = historyOf(call)
    const turn = events.filter((event) => event.kind === "heard").length + 1
    const context = { call, brief: briefFor(bundle, call), history, turn }
    // The simulated callee's model is not the agent's cost (a real callee is a person): it stays off the meter.
    const result = "clip" in input
      ? await agent.turn({ ...context, clip: input.clip, speech })
      : await agent.turn({ ...context, text: { ...input.text, cost: 0 }, speech: null })
    const now = await deps.clock()
    const base = { callId: call.id, orderId: call.orderId, at: now, wallAt: iso(wall()) }
    let seq = events.length
    const heardError = "text" in input ? input.text.error ?? null : null
    const out: StoredCallEvent[] = [
      { ...base, seq: seq++, by: "callee", kind: "heard", text: result.heard.text || "(nothing heard)", data: {
        seconds: result.heard.seconds, cost: result.heard.cost, model: result.heard.model, ...(heardError ? { error: heardError } : {}),
      } },
      { ...base, seq: seq++, by: "agent", kind: "checked", text: checkLine(result), data: { check: result.check, cost: result.checkCost, model: result.checkModel, error: result.checkError, seconds: 0 } },
      { ...base, seq: seq++, by: "agent", kind: "said", text: result.said.text, data: {
        audioId: result.said.audioId, seconds: result.said.seconds, cost: result.said.cost, model: result.said.model, path: result.path, error: result.voiceError,
      } },
    ]
    if (result.check.next !== "continue") {
      const sofar = foldCall([...events, ...out], rates)
      const { claims, changes } = tier2Said(sofar)
      const name = call.callee.name ? call.callee.name.split(",")[0] : call.callee.handle
      const resolved = result.check.next === "resolved"
      const summary = resolved ? `${name}: ${result.check.summary}` : `${name}: ${result.check.summary} A person should follow up.`
      out.push({ ...base, seq: seq++, by: "agent", kind: "ended", text: summary, data: {
        outcome: resolved ? "resolved" : "handover", summary, claims, changes,
        ...(resolved ? {} : { handover: {
          question: result.check.openQuestion ?? "What the voice agent could not settle on the call.",
          nextStep: result.check.nextStep ?? `Call ${name} back.`, summary: result.check.summary,
        } }),
      } })
    }
    if (!(await store.appendCallEvents(out))) throw new Error(`${call.id} moved on while the agent was answering`)
    if (out.some((event) => event.kind === "ended")) await deps.ended(foldCall([...events, ...out], rates))
  }

  /** The simulated callee's tier-2 turn: once the agent's last words have had time to be said, it answers in text. */
  async function talkStep(events: StoredCallEvent[]): Promise<boolean> {
    const call = foldCall(events, rates)
    const bundle = deps.bundles.get(call.orderId)
    if (!person.talk || !bundle || wall() < new Date(call.lastWallAt).getTime() + call.lastSeconds * 1000 * pace) return false
    const text = await person.talk({ call, bundle, history: historyOf(call) })
    try {
      await voiceStep(events, { text })
      return true
    } catch (error) {
      // Another process took this turn first: its step stands, this one is dropped.
      if (error instanceof Error && /moved on/.test(error.message)) return false
      throw error
    }
  }

  async function startLine(bundle: Bundle, header: CallHeader): Promise<boolean> {
    const event: StoredCallEvent = {
      callId: header.callId, orderId: header.orderId, seq: 0, at: await deps.clock(), wallAt: iso(wall()), by: "agent", kind: "started",
      text: `${header.answerer === "live" ? "Ringing live" : "Calling"} ${header.callee.name ?? header.callee.handle} (${header.callee.handle}) about ${bundle.order.reference}.`,
      data: { header, seconds: 0 },
    }
    if (!(await store.appendCallEvents([event]))) return false
    // A live call's prompts are spoken while it rings (one after the other, not awaited), so
    // answering and each key press play at once instead of waiting a second or two for a new voice reading.
    if (header.answerer === "live" && speech) void promptsFor(header).reduce((done: Promise<unknown>, text) => done.then(() => speech.speak(text)), Promise.resolve())
    return true
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
      if (busy(view.current.id)) continue
      if (await onCall(view.current.id, () => calleeStep(events, { type: "no_answer" }, Math.round(Math.min(120, seconds) * 10) / 10))) changed = true
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
    // A call busy with a turn (the phone's input, a voice turn, a prompt still being spoken) is left for the next round.
    const steps = [...(await eventsByCall()).values()].map((events) => busy(events[0].callId) ? false : onCall(events[0].callId, async () => {
      const call = foldCall(events, rates)
      if (call.state === "ended") return false
      if (call.state === "tier2") return call.expecting?.type === "speech" && call.answerer === "simulated" ? talkStep(events) : false
      if (!call.expecting) return agentStep(events)
      if (call.answerer !== "simulated") return false
      const reply = person.respond(call)
      const wait = (call.expecting.type === "ring" ? reply.seconds : call.lastSeconds) * 1000 * pace
      if (wall() < new Date(call.lastWallAt).getTime() + wait) return false
      return calleeStep(events, reply.input, reply.seconds)
    }))
    return (await Promise.all(steps)).some(Boolean) || changed
  }

  // One turn at a time per call in this process; (callId, seq) keeps processes apart, and
  // keeps a hang-up (which waits for nothing) from crossing a turn: the later write is refused.
  const calls = new Map<string, Promise<unknown>>()
  const busy = (callId: string) => calls.has(callId)
  function onCall<T>(callId: string, work: () => Promise<T>): Promise<T> {
    const run = (calls.get(callId) ?? Promise.resolve()).then(work)
    const tail = run.catch(() => {})
    calls.set(callId, tail)
    void tail.then(() => { if (calls.get(callId) === tail) calls.delete(callId) })
    return run
  }

  /** The callee's move on a live call; re-read and retried when another write took its step first. */
  async function liveInput(callId: string, input: CalleeInput): Promise<Call> {
    for (let attempt = 0; ; attempt++) {
      const events = (await eventsByCall()).get(callId)
      if (!events) throw new Error(`No call ${callId}`)
      const call = foldCall(events, rates)
      const behind = queuedBehind([...(await read()).values()].flat(), call)
      if (behind) throw new Error(behind)
      const seconds = Math.min(120, Math.max(0, (wall() - new Date(call.lastWallAt).getTime()) / 1000))
      if (await calleeStep(events, input, Math.round(seconds * 10) / 10) || attempt >= 4) return foldCall((await eventsByCall()).get(callId)!, rates)
    }
  }

  // Runner rounds and call starts one at a time in this process.
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
    // A hang-up does not wait for the agent's turn in progress: it ends the call now, and that turn's write is refused.
    input: (callId, input) => input.type === "hang_up" ? liveInput(callId, input) : onCall(callId, () => liveInput(callId, input)),
    voice: (callId, clip) => onCall(callId, async () => {
      const events = (await eventsByCall()).get(callId)
      if (!events) throw new Error(`No call ${callId}`)
      const behind = queuedBehind([...(await read()).values()].flat(), foldCall(events, rates))
      if (behind) throw new Error(behind)
      await voiceStep(events, { clip })
      return foldCall((await eventsByCall()).get(callId)!, rates)
    }),
    phone,
  }
}

/** The tier-2 conversation so far, as text: the opener, then each turn's words and reply. */
function historyOf(call: Call): VoiceTurn[] {
  return call.transcript.filter((line) => line.tier === 2 && line.by !== "system").map((line) => ({ by: line.by === "agent" ? "agent" : "callee", text: line.text }))
}

/** The "checked" line in the transcript: the checker's result in one sentence. */
function checkLine(result: TurnResult): string {
  const { check } = result
  const parts = [
    check.claims.length ? `Heard: ${check.claims.join("; ")}.` : "No new facts.",
    ...(check.changes.length ? [`Change to propose: ${check.changes.map((change) => change.title).join("; ")}.`] : []),
    ...(check.conflicts.length ? [`Conflicts with the records: ${check.conflicts.join("; ")}.`] : []),
    ...(check.replyOk === false ? [`Audio reply not used${check.replyIssue ? `: ${check.replyIssue}` : ""}.`] : []),
    `Next: ${check.next === "continue" ? "keep talking" : check.next === "resolved" ? "end, resolved" : "hand over to a person"}.`,
  ]
  return `${result.checkError ? "Check failed, safe reply. " : ""}${parts.join(" ")}`
}
