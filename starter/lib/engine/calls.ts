// Calls (ticket 10): the agent's mock phone calls to sites and drivers.
//
// State machine (spec "Call state machine"):
//
//   ringing ──answer──> answered ──> availability ──1──> tier1 ──all answered──> ended (resolved)
//      │                                 │                 │
//      ├─decline──> declined ─┐          └─2─> callback_time ──digit──> ended (callback)
//      └─no answer─> no_answer┴──> ended (callback; "unreachable" after MAX_ATTEMPTS)
//                                                          └─problem / unclear──> tier2
//   tier2: ticket 12 runs the voice agent there. Without it the call ends politely
//   as "handover" (a person follows up; ticket 14 makes that a tier-3 handover).
//
// A call is an append-only list of events in the store; `foldCall` reads the current
// state from them. Two turns alternate:
// - the callee's (`expecting` is set): ring response or a keypad digit. Background
//   calls are answered by the simulated person; live calls (ticket 11) wait for the
//   phone page to send a `callEvent` command.
// - the agent's (`expecting` is null): `agentTurn` decides what to say next.
//
// "Who answers" is the seam: `CallOptions.answererFor(header)` returns "simulated" or
// "live" when a call starts; the engine only drives simulated callees itself.
//
// Lines: an order has at most one site line and one driver line. A line's topics are
// the rules' planned calls (`rule:R10`) and the reviewer's call proposals
// (`proposal:<id>`). A topic is covered once a call that carried it ended for good
// (resolved, handover, unreachable); a callback keeps it open until the callback runs.

import { createHash } from "node:crypto"
import { rows, str, type Bundle } from "@/lib/present/bundle"
import { isCustomerSide, type ContactType } from "@/lib/reviewer/policy"
import {
  AVAILABLE_OPTIONS, CALLBACK_MINUTES, CALLBACK_OPTIONS, CALLBACK_QUESTION, callbackLine, CLOSING, greeting, HANDOVER_LINE,
  questionsFor, RETRY_PREFIX, type KeyOption, type OptionEffect, type Question, type Topic,
} from "./call-script"
import type { PlannedAction } from "./checks"
import type { DueItem } from "./due"
import type { Proposal } from "./proposals"

export type CallLine = "site" | "driver"
export type CallState =
  | "ringing" | "answered" | "declined" | "no_answer"
  | "availability" | "callback_time" | "tier1" | "tier2" | "ended"
export type CallOutcome = "resolved" | "callback" | "handover" | "unreachable"
export type Answerer = "simulated" | "live"
export type CalleeInput = { type: "answer" } | { type: "decline" } | { type: "no_answer" } | { type: "key"; digit: string }
export type Tier = 1 | 2 | 3

export type CallCallee = { name: string | null; handle: string; role: string | null; contactType: ContactType; recordId: string | null }

/** What a call is about and who it goes to; fixed when it starts. */
export type CallHeader = {
  callId: string
  orderId: string
  reference: string
  line: CallLine
  /** 1 for a first call; 2, 3 for callbacks in a row. */
  attempt: number
  answerer: Answerer
  callee: CallCallee
  topics: Topic[]
  questions: Question[]
  /** Why the agent calls, one line. */
  reason: string
  car: string | null
}

export type CallEventKind = "started" | "answered" | "declined" | "no_answer" | "said" | "pressed" | "tier" | "callback" | "ended"

export type CallChange = { title: string; change: string; claim: string }

export type StoredCallEvent = {
  callId: string
  orderId: string
  /** 0-based position in the call; (callId, seq) is unique, so two writers can't both append the same step. */
  seq: number
  /** Demo clock. */
  at: string
  /** Real time, for pacing and for measuring live answers. */
  wallAt: string
  by: "agent" | "callee"
  kind: CallEventKind
  text: string
  data: {
    header?: CallHeader
    /** "available", "callback_time" or "q<index>" for a tier-1 question; absent on a statement. */
    ask?: string
    audioId?: string | null
    /** How long the step took on the phone. */
    seconds?: number
    /** Model cost in USD (speech generation). */
    cost?: number
    cached?: boolean
    digit?: string
    label?: string
    tier?: Tier
    callbackAt?: string
    outcome?: CallOutcome
    summary?: string
    claims?: string[]
    changes?: CallChange[]
  } | null
}

export type Expecting =
  | { type: "ring" }
  | { type: "key"; ask: string; text: string; options: { digit: string; label: string }[] }

export type TranscriptLine = {
  at: string
  wallAt: string
  by: "agent" | "callee" | "system"
  text: string
  tier: Tier
  audioId: string | null
}

export type CostRates = {
  /** Mock phone time, EUR per connected minute. */
  phonePerMinuteEur: number
  /** What an operator's minute costs, EUR (the comparison line). */
  operatorPerMinuteEur: number
  /** Model costs are reported in USD. */
  eurPerUsd: number
}

export const DEFAULT_RATES: CostRates = { phonePerMinuteEur: 0.01, operatorPerMinuteEur: 0.7, eurPerUsd: 0.92 }

export type CallCost = {
  /** Summed model `usage.cost` (speech), USD. */
  modelUsd: number
  ringSeconds: number
  /** Connected phone time. */
  phoneSeconds: number
  modelEur: number
  phoneEur: number
  totalEur: number
  /** The same call made by an operator: at least one minute. */
  operatorEur: number
  rates: CostRates
}

export type Call = Omit<CallHeader, "callId"> & {
  id: string
  state: CallState
  /** Every state the call went through, in order. */
  path: CallState[]
  tier: Tier
  /** What the callee must do next; null on the agent's turn or once ended. */
  expecting: Expecting | null
  answers: { ask: string; digit: string; label: string }[]
  transcript: TranscriptLine[]
  callbackAt: string | null
  outcome: CallOutcome | null
  summary: string | null
  claims: string[]
  changes: CallChange[]
  cost: CallCost
  startedAt: string
  endedAt: string | null
  /** Real time of the latest event (for pacing). */
  lastWallAt: string
  lastSeconds: number
}

export const MAX_ATTEMPTS = 3
const NO_ANSWER_CALLBACK_MINUTES = 30
const DECLINED_CALLBACK_MINUTES = 60
const UNCLEAR_CALLBACK_MINUTES = 60

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits

export function costOf(events: StoredCallEvent[], rates: CostRates): CallCost {
  let modelUsd = 0
  let ringSeconds = 0
  let phoneSeconds = 0
  let connected = false
  for (const event of events) {
    modelUsd += event.data?.cost ?? 0
    const seconds = event.data?.seconds ?? 0
    if (event.kind === "answered" || event.kind === "declined" || event.kind === "no_answer") { ringSeconds += seconds; connected = event.kind === "answered"; continue }
    if (connected) phoneSeconds += seconds
  }
  const modelEur = modelUsd * rates.eurPerUsd
  const phoneEur = (phoneSeconds / 60) * rates.phonePerMinuteEur
  const operatorEur = Math.max(1, (ringSeconds + phoneSeconds) / 60) * rates.operatorPerMinuteEur
  return {
    modelUsd: round(modelUsd), ringSeconds: round(ringSeconds, 1), phoneSeconds: round(phoneSeconds, 1),
    modelEur: round(modelEur), phoneEur: round(phoneEur), totalEur: round(modelEur + phoneEur), operatorEur: round(operatorEur, 4), rates,
  }
}

function optionsFor(header: CallHeader, ask: string): { text: string; options: KeyOption[] } | null {
  if (ask === "available") return { text: greeting({ name: header.callee.name, reference: header.reference, car: header.car, line: header.line }), options: AVAILABLE_OPTIONS }
  if (ask === "callback_time") return { text: CALLBACK_QUESTION, options: CALLBACK_OPTIONS }
  const question = header.questions[Number(ask.slice(1))]
  return question ? { text: question.text, options: question.options } : null
}

/** The call as it stands, from its events (oldest first). */
export function foldCall(events: StoredCallEvent[], rates: CostRates = DEFAULT_RATES): Call {
  const header = events[0]?.data?.header
  if (!header) throw new Error(`Call ${events[0]?.callId ?? "?"} has no start event`)
  let state: CallState = "ringing"
  const path: CallState[] = ["ringing"]
  let tier: Tier = 1
  let asking: string | null = null
  const answers: Call["answers"] = []
  const transcript: TranscriptLine[] = []
  let callbackAt: string | null = null
  let outcome: CallOutcome | null = null
  let summary: string | null = null
  let claims: string[] = []
  let changes: CallChange[] = []
  let endedAt: string | null = null
  const move = (next: CallState) => { if (state !== next) { state = next; path.push(next) } }
  const line = (event: StoredCallEvent, by: TranscriptLine["by"], text: string) =>
    transcript.push({ at: event.at, wallAt: event.wallAt, by, text, tier, audioId: event.data?.audioId ?? null })
  for (const event of events) {
    switch (event.kind) {
      case "started":
        line(event, "system", event.text)
        break
      case "answered": case "declined": case "no_answer":
        move(event.kind)
        line(event, event.kind === "answered" ? "callee" : "system", event.text)
        break
      case "said": {
        const ask = event.data?.ask
        if (ask === "available") move("availability")
        else if (ask === "callback_time") move("callback_time")
        else if (ask && tier === 1) move("tier1")
        asking = ask ?? null
        line(event, "agent", event.text)
        break
      }
      case "pressed":
        answers.push({ ask: asking ?? "", digit: event.data?.digit ?? "", label: event.data?.label ?? "" })
        asking = null
        line(event, "callee", event.text)
        break
      case "tier":
        tier = event.data?.tier ?? 2
        move(tier === 2 ? "tier2" : state)
        line(event, "system", event.text)
        break
      case "callback":
        callbackAt = event.data?.callbackAt ?? null
        line(event, "system", event.text)
        break
      case "ended":
        move("ended")
        outcome = event.data?.outcome ?? "resolved"
        summary = event.data?.summary ?? null
        claims = event.data?.claims ?? []
        changes = event.data?.changes ?? []
        endedAt = event.at
        line(event, "system", event.text)
        break
    }
  }
  const last = events[events.length - 1]
  let expecting: Expecting | null = null
  if (state === "ringing") expecting = { type: "ring" }
  else if (state !== "ended" && asking && last.kind === "said") {
    const asked = optionsFor(header, asking)
    if (asked) expecting = { type: "key", ask: asking, text: last.text, options: asked.options.map(({ digit, label }) => ({ digit, label })) }
  }
  const { callId, ...rest } = header
  return {
    ...rest, id: callId, state, path, tier, expecting, answers, transcript, callbackAt, outcome, summary, claims, changes,
    cost: costOf(events, rates), startedAt: events[0].at, endedAt, lastWallAt: last.wallAt, lastSeconds: last.data?.seconds ?? 0,
  }
}

/** One step the agent takes: say something, or record a fact. Speech is added by the layer. */
export type AgentStep =
  | { kind: "said"; text: string; ask?: string }
  | { kind: "tier"; tier: Tier; text: string }
  | { kind: "callback"; callbackAt: string; text: string }
  | { kind: "ended"; outcome: CallOutcome; text: string; summary: string; claims: string[]; changes: CallChange[] }

const MINUTE = 60_000
const addMinutes = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * MINUTE).toISOString()

/** "14:15" in the callee's zone (Helsinki for the demo data). */
export function localTime(iso: string, zone = "Europe/Helsinki"): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date(iso))
}

function who(callee: CallCallee): string {
  return callee.name ? callee.name.split(",")[0] : callee.handle
}

/** What the person said on the call, in order: claims, changes (as claims) and escalations. */
function said(call: Call): { claims: string[]; changes: CallChange[]; escalation: string | null } {
  const claims: string[] = []
  const changes: CallChange[] = []
  let escalation: string | null = null
  for (const answer of call.answers) {
    if (!answer.ask.startsWith("q")) continue
    const option = call.questions[Number(answer.ask.slice(1))]?.options.find((row) => row.digit === answer.digit)
    if (!option) continue
    const effect: OptionEffect = option.effect
    if (effect.type === "claim") claims.push(effect.text)
    if (effect.type === "change") { claims.push(effect.claim); changes.push({ title: effect.title, change: effect.change, claim: effect.claim }) }
    if (effect.type === "escalate") { claims.push(effect.text); escalation = effect.text }
  }
  return { claims, changes, escalation }
}

function ending(call: Call, outcome: CallOutcome, text: string, extra: { escalation?: string | null } = {}): AgentStep {
  const { claims, changes } = said(call)
  const name = who(call.callee)
  const summary = outcome === "resolved" ? `${name}: ${claims.length ? claims.join("; ") : "nothing to report"}.`
    : outcome === "handover" ? `${name}: ${extra.escalation ?? "needs a conversation"}. A person should follow up.`
    : outcome === "unreachable" ? `No answer from ${name} after ${call.attempt} attempts.`
    : `${name} asked for a callback.`
  return { kind: "ended", outcome, text: summary, summary, claims, changes }
}

/**
 * The agent's next steps on a call whose turn it is (`expecting` null), as of the
 * demo time `now`. `tier2` says whether a voice agent can take the call over
 * (ticket 12); without one an escalation ends the call as a handover.
 */
export function agentTurn(call: Call, now: string, tier2: boolean, lastEvent: StoredCallEvent): AgentStep[] {
  if (call.state === "ended" || call.expecting) return []
  const next = (from: number): AgentStep[] => {
    const answered = new Set(call.answers.filter((row) => row.ask.startsWith("q") && call.questions[Number(row.ask.slice(1))]?.options.some((option) => option.digit === row.digit)).map((row) => row.ask))
    const index = call.questions.findIndex((_question, i) => i >= from && !answered.has(`q${i}`))
    if (index < 0) return [{ kind: "said", text: CLOSING }, ending(call, "resolved", CLOSING)]
    return [{ kind: "said", text: call.questions[index].text, ask: `q${index}` }]
  }
  const callback = (minutes: number, line: boolean): AgentStep[] => {
    if (call.attempt >= MAX_ATTEMPTS) return [ending(call, "unreachable", "")]
    const callbackAt = addMinutes(now, minutes)
    return [
      ...(line ? [{ kind: "said" as const, text: callbackLine(localTime(callbackAt)) }] : []),
      { kind: "callback", callbackAt, text: `Callback scheduled for ${localTime(callbackAt)} (demo clock).` },
      ending(call, "callback", ""),
    ]
  }
  switch (lastEvent.kind) {
    case "answered":
      return [{ kind: "said", text: optionsFor(headerOf(call), "available")!.text, ask: "available" }]
    case "declined":
      return callback(DECLINED_CALLBACK_MINUTES, false)
    case "no_answer":
      return callback(NO_ANSWER_CALLBACK_MINUTES, false)
    case "pressed": {
      const answer = call.answers[call.answers.length - 1]
      const asked = optionsFor(headerOf(call), answer.ask)
      const option = asked?.options.find((row) => row.digit === answer.digit)
      const retried = call.answers.filter((row) => row.ask === answer.ask).length > 1
      if (!option) {
        if (!retried && asked) return [{ kind: "said", text: RETRY_PREFIX + asked.text, ask: answer.ask }]
        if (answer.ask === "available" || answer.ask === "callback_time") return callback(UNCLEAR_CALLBACK_MINUTES, true)
        return escalate(call, "Unclear keypad answers", tier2)
      }
      if (answer.ask === "available") return option.digit === "1" ? next(0) : [{ kind: "said", text: CALLBACK_QUESTION, ask: "callback_time" }]
      if (answer.ask === "callback_time") return callback(CALLBACK_MINUTES[option.digit] ?? UNCLEAR_CALLBACK_MINUTES, true)
      if (option.effect.type === "escalate") return escalate(call, option.effect.text, tier2)
      return next(Number(answer.ask.slice(1)) + 1)
    }
    default:
      return []
  }
}

function escalate(call: Call, why: string, tier2: boolean): AgentStep[] {
  const move: AgentStep = { kind: "tier", tier: 2, text: `Moved to tier 2: ${why}.` }
  if (tier2) return [move]
  return [move, { kind: "said", text: HANDOVER_LINE }, ending(call, "handover", HANDOVER_LINE, { escalation: why })]
}

function headerOf(call: Call): CallHeader {
  return {
    callId: call.id, orderId: call.orderId, reference: call.reference, line: call.line, attempt: call.attempt, answerer: call.answerer,
    callee: call.callee, topics: call.topics, questions: call.questions, reason: call.reason, car: call.car,
  }
}

/** Is the callee's input acceptable now? Returns why not, or null. */
export function refuseInput(call: Call, input: CalleeInput): string | null {
  if (call.state === "ended") return `${call.id} has ended`
  if (!call.expecting) return `${call.id} is waiting for the agent`
  if (call.expecting.type === "ring" && input.type === "key") return `${call.id} is ringing: answer, decline or let it ring out first`
  if (call.expecting.type === "key" && input.type !== "key") return `${call.id} is waiting for a keypad answer`
  if (input.type === "key" && !/^[0-9*#]$/.test(input.digit)) return `"${input.digit}" is not a keypad key`
  return null
}

/** The stored event for a callee's input. */
export function calleeEvent(call: Call, input: CalleeInput, base: Pick<StoredCallEvent, "callId" | "orderId" | "seq" | "at" | "wallAt">, seconds: number): StoredCallEvent {
  const name = who(call.callee)
  switch (input.type) {
    case "answer": return { ...base, by: "callee", kind: "answered", text: `${name} answered.`, data: { seconds } }
    case "decline": return { ...base, by: "callee", kind: "declined", text: `${name} declined the call.`, data: { seconds } }
    case "no_answer": return { ...base, by: "callee", kind: "no_answer", text: "No answer.", data: { seconds } }
    case "key": {
      const ask = call.expecting?.type === "key" ? call.expecting.ask : ""
      const label = call.expecting?.type === "key" ? call.expecting.options.find((option) => option.digit === input.digit)?.label ?? "not an option" : ""
      return { ...base, by: "callee", kind: "pressed", text: `Pressed ${input.digit}: ${label}.`, data: { seconds, digit: input.digit, label, ask } }
    }
  }
}

// -- Lines: what each order needs from calls ----------------------------------

export type LineStatus =
  /** Topics to call about and nothing started yet. */
  | "to_call"
  /** A call is running. */
  | "calling"
  /** The last call asked for a callback that has not come due. */
  | "callback"
  /** The callback time has come; the agent calls on its next run. */
  | "callback_due"
  /** The last call ended needing a person (handover, unreachable). */
  | "needs_person"
  /** Nothing left to call about. */
  | "done"

export type CallLineView = {
  line: CallLine
  status: LineStatus
  callee: CallCallee | null
  /** Topics no finished call has covered yet. */
  open: Topic[]
  latest: Call | null
  /** One line for the order's reason. */
  text: string
}

/** A planned call the agent will not make: the callee is on the customer side (ADR 0001). */
export type BlockedCall = { line: CallLine; ruleIds: string[]; text: string }

export type OrderCalls = {
  orderId: string
  calls: Call[]
  lines: CallLineView[]
  blocked: BlockedCall[]
  /** The rules' planned work without the site/driver calls the call lines now carry. */
  planned: PlannedAction[]
  /** Call proposals a running call or callback carries (their "Agent will call" reason is the line's). */
  carried: Set<string>
}

const RULE_TOPIC_TITLE: Record<string, string> = {
  R1: "Signed release", R4: "Contact confirmed only from the site profile", R5: "Contact not confirmed", R6: "Delivery promise not from the customer",
  NEXT: "Next check due", R10: "Tracking is stale", R12: "ETA after the promise",
}

/** The contact type of the order's pickup endpoint (ADR 0001): customer-given or customer-owned contacts are never called. */
function endpointContactType(bundle: Bundle, endpointId: string): ContactType {
  const endpoint = rows(bundle, "order_endpoint_details").find((row) => row.id === endpointId)
  if (str(endpoint?.details.stated_by) === "CUSTOMER_ORDER_INPUT") return "customer_given_contact"
  const siteId = str(endpoint?.details.site_id)
  const site = siteId ? bundle.sites.get(siteId) : undefined
  if (site && str(site.details.customer_id) === bundle.customer.id) return "customer_owned_site"
  return "third_party_site"
}

function driverOf(bundle: Bundle): CallCallee | null {
  const moving = rows(bundle, "work_assignments").filter((row) => row.details.order_id === bundle.order.id && row.details.status === "IN_PROGRESS")
  const assignment = moving[0] ?? rows(bundle, "work_assignments").find((row) => row.details.order_id === bundle.order.id)
  const driverId = str(assignment?.details.driver_id)
  if (!assignment || !driverId) return null
  return { name: bundle.dir.driverName(driverId), handle: driverId, role: "driver", contactType: "driver", recordId: assignment.id }
}

export function carOf(bundle: Bundle): string | null {
  const vehicle = bundle.items[0]?.vehicle
  return vehicle ? `${vehicle.make} ${vehicle.model}` : null
}

const COVERING: CallOutcome[] = ["resolved", "handover", "unreachable"]

/**
 * Pure: an order's planned calls and call proposals, and its calls so far (oldest
 * first), as lines with a status at `now`.
 */
export function orderCalls(bundle: Bundle, planned: PlannedAction[], proposals: Proposal[], calls: Call[], now: string): OrderCalls {
  const blocked: BlockedCall[] = []
  const topics = new Map<CallLine, { callee: CallCallee | null; topics: Topic[] }>()
  const add = (line: CallLine, callee: CallCallee | null, topic: Topic) => {
    const entry = topics.get(line) ?? { callee, topics: [] }
    entry.callee ??= callee
    if (!entry.topics.some((row) => row.id === topic.id)) entry.topics.push(topic)
    topics.set(line, entry)
  }
  for (const action of planned) {
    if (action.kind === "reviewer_pass") continue
    const line: CallLine = action.kind === "site_call" ? "site" : "driver"
    let callee: CallCallee | null = null
    if (action.kind === "site_call" && action.callee) {
      const type = endpointContactType(bundle, action.callee.endpointId)
      if (isCustomerSide(type)) {
        blocked.push({ line, ruleIds: action.ruleIds, text: `No call to ${action.callee.name ?? action.callee.handle}: a ${type === "customer_owned_site" ? "customer-owned site" : "contact the customer gave"} is customer side, so the agent only proposes.` })
        continue
      }
      callee = { name: action.callee.name, handle: action.callee.handle, role: action.callee.role, contactType: type, recordId: action.callee.endpointId }
    } else if (action.kind === "driver_call") {
      callee = driverOf(bundle)
    }
    if (!callee) continue
    for (const id of action.ruleIds) add(line, callee, { id: `rule:${id}`, kind: "rule", title: RULE_TOPIC_TITLE[id] ?? id })
  }
  for (const proposal of proposals) {
    if (proposal.kind !== "call" || proposal.waitingOn !== "agent" || !proposal.contact.handle) continue
    const line: CallLine = proposal.contact.type === "driver" || proposal.contact.role === "driver" ? "driver" : "site"
    add(line, { name: proposal.contact.name, handle: proposal.contact.handle, role: proposal.contact.role, contactType: proposal.contact.type, recordId: proposal.contact.recordId },
      { id: `proposal:${proposal.id}`, kind: "proposal", title: proposal.title, script: proposal.script })
  }

  const lines: CallLineView[] = []
  const carried = new Set<string>()
  const lineNames = new Set<CallLine>([...topics.keys(), ...calls.map((call) => call.line)])
  for (const line of (["site", "driver"] as CallLine[]).filter((name) => lineNames.has(name))) {
    const onLine = calls.filter((call) => call.line === line)
    const covered = new Set(onLine.filter((call) => call.outcome && COVERING.includes(call.outcome)).flatMap((call) => call.topics.map((topic) => topic.id)))
    const entry = topics.get(line)
    const open = (entry?.topics ?? []).filter((topic) => !covered.has(topic.id))
    const latest = onLine[onLine.length - 1] ?? null
    const callee = entry?.callee ?? latest?.callee ?? null
    const name = callee ? who(callee) : line
    let status: LineStatus
    let text: string
    if (latest && latest.state !== "ended") {
      status = "calling"
      text = `Calling ${name} (tier ${latest.tier}): ${latest.reason}`
    } else if (latest?.outcome === "callback" && latest.callbackAt && (open.length || latest.topics.length)) {
      status = latest.callbackAt > now ? "callback" : "callback_due"
      text = status === "callback" ? `Callback to ${name} at ${localTime(latest.callbackAt)}.` : `Callback to ${name} is due; the agent calls now.`
    } else if (open.length) {
      status = "to_call"
      text = `Agent will call ${name}: ${open.map((topic) => topic.title).join("; ")}.`
    } else if (latest && (latest.outcome === "handover" || latest.outcome === "unreachable")) {
      status = "needs_person"
      text = `Call needs a person: ${latest.summary ?? latest.reason}`
    } else {
      status = "done"
      text = latest?.summary ? `Call result: ${latest.summary}` : ""
    }
    if (status === "calling" || status === "callback" || status === "callback_due") {
      for (const topic of [...(latest?.topics ?? []), ...open]) if (topic.kind === "proposal") carried.add(topic.id.slice("proposal:".length))
    }
    lines.push({ line, status, callee, open, latest, text })
  }
  // Planned site/driver calls are now carried by the lines: keep them in `planned` only until a call starts.
  const keep = planned.filter((action) => {
    if (action.kind === "reviewer_pass") return true
    const line = lines.find((row) => row.line === (action.kind === "site_call" ? "site" : "driver"))
    return !!line && line.status === "to_call" && line.latest === null && line.open.some((topic) => action.ruleIds.some((id) => topic.id === `rule:${id}`))
  })
  return { orderId: bundle.order.id, calls, lines, blocked, planned: keep, carried }
}

/** Starting a call on a line: its header. */
export function newCallHeader(bundle: Bundle, line: CallLineView, previous: Call[], answerer: (header: Omit<CallHeader, "answerer">) => Answerer): CallHeader {
  const callee = line.callee
  if (!callee) throw new Error(`${bundle.order.reference}: no one to call on the ${line.line} line`)
  const onLine = previous.filter((call) => call.line === line.line)
  const latest = onLine[onLine.length - 1]
  const attempt = latest?.outcome === "callback" ? latest.attempt + 1 : 1
  // A callback carries the topics of the call it follows up, plus any new ones.
  const topics = [...(attempt > 1 ? latest!.topics.filter((topic) => !line.open.some((row) => row.id === topic.id)) : []), ...line.open]
  const base: Omit<CallHeader, "answerer"> = {
    callId: `call-${bundle.order.id}-${line.line}-${onLine.length + 1}`,
    orderId: bundle.order.id, reference: bundle.order.reference, line: line.line, attempt, callee, topics,
    questions: questionsFor(topics, callee),
    reason: `${attempt > 1 ? `Callback (attempt ${attempt}). ` : ""}${topics.map((topic) => topic.title).join("; ")}.`,
    car: carOf(bundle),
  }
  return { ...base, answerer: answerer(base) }
}

/** Callbacks as due items (level-based like next checks: due once the clock reaches them). */
export function callbackItems(calls: Call[]): Omit<DueItem, "due">[] {
  return calls.filter((call) => call.outcome === "callback" && call.callbackAt).map((call) => ({
    id: `callback:${call.id}`, kind: "callback" as const, at: call.callbackAt!, orderId: call.orderId, reference: call.reference,
    title: "Callback", detail: `to ${who(call.callee)}`, label: `Callback to ${who(call.callee)} on ${call.reference}`,
  }))
}

/** A stable small number per string, for the simulated person's variety. */
export function bucket(text: string, size: number): number {
  return parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16) % size
}
