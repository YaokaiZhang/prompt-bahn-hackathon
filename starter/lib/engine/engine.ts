// The operations engine: the single seam the UI and API talk to.
//
//   state(now?)      reads every order as of `now` (default: the demo clock)
//   apply(command)   changes engine state and returns the new state
//
// The engine reads the snapshot only through per-order bundles and keeps its own
// state behind the store port. It never writes the snapshot (ADR 0002).
//
// Extending: add a variant to `Command` and a case to `apply`; add fields to
// `OrderState` / `EngineState` and compute them in `state`. `assertNever` makes
// the compiler point at every switch that misses a new command.

import type { Bundle } from "@/lib/present/bundle"
import type { AskRole, ContactType } from "@/lib/reviewer/policy"
import { compareUrgency, GROUPS, verdictFor, type Group, type RuleResult, type Verdict } from "./checks"
import { briefingAsOf, digestFacts, digestTimes, digestTitle, pushId, sendPush, type Briefing, type DigestItem, type PushInput } from "./briefing"
import { writeProse, type ProseOptions } from "./digest-prose"
import { becameDue, digestDueItems, dueAsOf, nextCheckItems, nextDueAfter, type DueItem } from "./due"
import {
  answersFor, changeDraft, instructionsFor, proposalsFor, type OrderProposals, type Proposal, type StoredProposalEvent, type Unreachable,
} from "./proposals"
import { createReviewLayer, reviewTotals, type OrderReview, type ReviewInputs, type ReviewOptions, type ReviewTotals } from "./reviews"
import { buildFleet, evaluateRules, type Evaluation } from "./rules"
import type { EngineStore } from "./store"
import { createCallRunner, type CallOptions } from "./call-runner"
import type { PhonePersona, PhoneView } from "./phone"
import type { AudioClip } from "./voice-agent"
import { callbackItems, orderCalls, utcTime, type BlockedCall, type Call, type CalleeInput, type CallLine, type CallLineView, type OrderCalls } from "./calls"

/** The snapshot as the engine reads it: one bundle per order. */
export type Snapshot = { snapshotAt: string; bundles: Bundle[] }

export type Command =
  /** "+15 min" in the demo controls; any positive number of minutes. */
  | { type: "advanceClock"; minutes: number }
  /** "Next due item": jump to the earliest due item after the clock; refused when none is left. */
  | { type: "advanceToNextDue" }
  | { type: "reset" }
  /** Runs the reviewer on the orders not reviewed yet (all, or `orderIds`). The seed sweep sends this. */
  | { type: "review"; orderIds?: string[] }
  /** The operator says yes to a proposal waiting for one. A customer-side proposal is handed to the operator. */
  | { type: "approve"; proposalId: string }
  /** Approves several proposals at once: all or nothing (refused if any cannot be approved). */
  | { type: "approveBatch"; proposalIds: string[] }
  /** Replaces the drafted script of an open proposal. */
  | { type: "editScript"; proposalId: string; script: string }
  /** Dismisses an open proposal; it keeps its history. */
  | { type: "dismiss"; proposalId: string; note?: string }
  /** Tells the agent to act differently: saved on the proposal and fed into the order's next review run, which runs now when a model is configured. */
  | { type: "instruct"; proposalId: string; text: string }
  /**
   * A change the engine's own machinery wants to make (a call result, ticket 10; a
   * customer answer, ticket 08): a proposal that needs a yes (policy row order-change).
   * Proposing the same change twice is a no-op.
   */
  | { type: "proposeChange"; orderId: string; title: string; change: string; why: string; source: string
      contact?: { name: string; type: ContactType; role: AskRole; recordId?: string | null } }
  /**
   * The operator records the customer's answer on an approved customer-side proposal
   * (after making the contact): the proposal becomes answered, the answer goes to the
   * order's next review run (which runs now when a model is configured), and the agent
   * proposes the order update for a yes.
   */
  | { type: "recordAnswer"; proposalId: string; answer: string }
  /** The operator answers the agent's question in the app: answered, and the answer goes to the order's next review run. */
  | { type: "answerQuestion"; proposalId: string; answer: string }
  /** Delivers what is due in the Briefing: digests whose time has come, pushes for orders that turned urgent. Clock moves and reset do this too. */
  | { type: "deliverBriefing" }
  /** Marks Briefing items read (all when `ids` is absent). */
  | { type: "markBriefingRead"; ids?: string[] }
  /**
   * The call agent's loop (ticket 10): starts calls for lines that need one (planned
   * site/driver calls, call proposals, callbacks that came due) and takes the agent's
   * and the simulated person's turns. `steps` rounds (the app's pump sends 1), or
   * until nothing changes.
   */
  | { type: "runCalls"; steps?: number }
  /** Starts a call on an order's site or driver line now; `live` rings the persona's phone page (ticket 11). */
  | { type: "startCall"; orderId: string; line: CallLine; live?: boolean }
  /** The callee's move on a call: answer, decline, let it ring out, or a keypad digit (live phones send these). */
  | { type: "callEvent"; callId: string; input: CalleeInput }
  /**
   * A tier-2 turn on a live call (ticket 12): the callee's push-to-talk recording. The
   * voice agent transcribes it, answers aloud and the checker records the turn's result.
   */
  | { type: "voiceTurn"; callId: string; audio: AudioClip }

/**
 * One order as the engine reads it at `now`. `group`, `reason`, `rules` (every
 * strong and weak check with its outcome, first action and source records),
 * `planned` (agent work the rules asked for) and `urgency` come from the rules
 * (ticket 03). The "checked / passed / couldn't check" lists are `rules`, all of
 * them / outcome "pass" / outcome "unknown".
 */
export type OrderState = {
  id: string
  reference: string
  status: string
  /** The reviewer's read of the order (ticket 06). */
  review: OrderReview
  /** What the agent wants to do on the order, under the approval policy (ticket 07); feeds `group`. */
  proposals: Proposal[]
  /** Findings the agent cannot act on: no contact on record (couldn't check). */
  unreachable: Unreachable[]
  /** The agent's calls on this order, oldest first, with transcript, tier and cost (ticket 10). */
  calls: Call[]
  /** The order's site and driver lines: what is left to call about and where each stands. */
  callLines: CallLineView[]
  /** Planned calls the agent will not make because the callee is on the customer side. */
  blockedCalls: BlockedCall[]
} & Verdict

export type GroupCounts = Record<Group, number>

export type { CitedRecord, OrderReview, ReviewFinding, ReviewTotals, ReviewTrigger } from "./reviews"
export type { Proposal, ProposalEvent, ProposalKind, ProposalStatus, Unreachable } from "./proposals"
export type { FirstAction, Group, Outcome, PlannedAction, RuleId, RuleResult, SourceRef, Urgency } from "./checks"
export type { DueItem, DueKind } from "./due"
export type {
  Answerer, BlockedCall, Call, CallCallee, Handover, CallCost, CalleeInput, CallLine, CallLineView, CallOutcome, CallState, CostRates, Expecting, LineStatus, Tier, TranscriptLine,
} from "./calls"
export type { CallOptions } from "./call-runner"
export type { PhonePersona, PhoneView, QueuedCall } from "./phone"
export type { AudioClip, TurnCheck, TurnPath, VoiceAgent } from "./voice-agent"
export type { Briefing, BriefingItem, DigestFacts, DigestItem, DigestSlot, PushItem, PushReason, PushInput } from "./briefing"
export type { DigestProse, ProseSegment } from "./digest-prose"
export { becameDue, GROUPS }

/** The Needs action group, most urgent first (urgent, then soonest deadline, then reference). */
export function rankNeedsAction<T extends Pick<OrderState, "group" | "urgency" | "reference">>(orders: T[]): T[] {
  return orders.filter((row) => row.group === "needs_action").sort(compareUrgency)
}

export type EngineState = {
  /** The demo clock (or the `now` passed to `state`), as an ISO string. */
  now: string
  snapshotAt: string
  orders: OrderState[]
  /** Orders per group; always adds up to the number of orders. */
  groupCounts: GroupCounts
  /** Reviewed / not reviewed, findings and the summed model cost. */
  reviews: ReviewTotals
  /** Every due item (next checks; later callbacks and digests), by time, each marked `due` once `now` reached it. */
  dueItems: DueItem[]
  /** The earliest time something comes due after `now`; null when nothing is left. */
  nextDueAt: string | null
  /** The Briefing inbox (ticket 13): digests and pushes delivered so far, as of `now`. */
  briefing: Briefing
}

export type Engine = {
  state(now?: Date | string): Promise<EngineState>
  apply(command: Command): Promise<EngineState>
  /** The demo clock as stored, as an ISO string. */
  clock(): Promise<string>
  /** The bundle the engine reads for one order, or null for an unknown id. */
  bundle(orderId: string): Bundle | null
  /** A persona's mock phone (ticket 11): the live call on it and the queue behind it. */
  phone(persona: PhonePersona): Promise<PhoneView>
}

export type EngineDeps = {
  snapshot: Snapshot
  store: EngineStore
  /** The reviewer's gateway, cache and inbox messages. Absent: every order "not reviewed yet". */
  reviews?: ReviewOptions
  /** The digest prose's model, cache and timeout. Absent: digests carry template text. */
  briefing?: ProseOptions
  /** Who answers calls, speech, tier 2, cost rates and pacing. Absent: simulated person, no speech. */
  calls?: CallOptions
}

const MINUTE = 60_000

function assertNever(value: never): never {
  throw new Error(`Unknown command: ${JSON.stringify(value)}`)
}

function isoOf(value: Date | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Not a time: ${String(value)}`)
  return date.toISOString()
}

export function createEngine({ snapshot, store, reviews: reviewOptions, briefing: proseOptions, calls: callOptions = {} }: EngineDeps): Engine {
  const start = isoOf(snapshot.snapshotAt)
  const bundles = new Map(snapshot.bundles.map((bundle) => [bundle.order.id, bundle]))
  const fleet = buildFleet(snapshot.bundles)
  const reviews = createReviewLayer(snapshot.bundles, start, reviewOptions)
  const nextChecks = nextCheckItems(snapshot.bundles)
  const digestSlots = digestTimes(start).map((slot) => ({ ...slot, title: digestTitle(slot.slot) }))
  const digestItems = digestDueItems(digestSlots)
  // Rules re-run only when the time read changes (load, clock move); effect
  // events (ticket 09) must clear this too, and call `reviews.forget(orderId)`.
  let last: { at: string; evaluations: Map<string, Evaluation> } | null = null
  // The rule results the reviewer reads: as of the review time (the snapshot), so
  // a clock move does not change the case file and re-review every order.
  const rulesAtReviewTime = new Map<string, RuleResult[]>()
  const rulesAtReview = (bundle: Bundle): RuleResult[] => {
    let rules = rulesAtReviewTime.get(bundle.order.id)
    if (!rules) {
      rules = evaluateRules(bundle, { now: start, fleet }).rules
      rulesAtReviewTime.set(bundle.order.id, rules)
    }
    return rules
  }

  function evaluationsAt(at: string): Map<string, Evaluation> {
    if (last?.at === at) return last.evaluations
    const evaluations = new Map(snapshot.bundles.map((bundle) => [bundle.order.id, evaluateRules(bundle, { now: at, fleet })]))
    last = { at, evaluations }
    return evaluations
  }

  function eventsByOrder(events: StoredProposalEvent[]): Map<string, StoredProposalEvent[]> {
    const out = new Map<string, StoredProposalEvent[]>()
    for (const event of events) {
      const list = out.get(event.orderId) ?? []
      list.push(event)
      out.set(event.orderId, list)
    }
    return out
  }

  /** What the reviewer reads besides the records: rules at the review time, and the operator's instructions. */
  function reviewInputs(events: Map<string, StoredProposalEvent[]>): ReviewInputs {
    return {
      rules: rulesAtReview,
      prior: (bundle) => {
        const stored = events.get(bundle.order.id) ?? []
        const instructions = instructionsFor(stored)
        const answers = answersFor(stored)
        if (!instructions.length && !answers.length) return undefined
        return { ...(instructions.length ? { instructions } : {}), ...(answers.length ? { answers } : {}) }
      },
    }
  }

  /** Each order's review, proposals and call lines at `at` (everything grouping reads besides the rules). */
  async function workAt(at: string): Promise<{ bundle: Bundle; evaluation: Evaluation; review: OrderReview; work: OrderProposals; calls: OrderCalls }[]> {
    const evaluations = evaluationsAt(at)
    const events = eventsByOrder(await store.readProposalEvents())
    const read = await reviews.read(reviewInputs(events))
    const calls = await callRunner.read()
    return snapshot.bundles.map((bundle) => {
      const evaluation = evaluations.get(bundle.order.id)!
      const review = read.get(bundle.order.id)!
      const work = proposalsFor(bundle, review, events.get(bundle.order.id) ?? [])
      // A done review fulfils the reviewer pass (verdictFor); the call lines carry the planned calls.
      return { bundle, evaluation, review, work, calls: orderCalls(bundle, evaluation.planned, work.proposals, calls.get(bundle.order.id) ?? [], at) }
    })
  }

  async function ordersAt(at: string): Promise<OrderState[]> {
    return (await workAt(at)).map(({ bundle, evaluation, review, work, calls }) => ({
      id: bundle.order.id,
      reference: bundle.order.reference,
      status: bundle.order.status,
      review,
      proposals: work.proposals,
      unreachable: work.unreachable,
      calls: calls.calls,
      callLines: calls.lines,
      blockedCalls: calls.blocked,
      ...verdictFor({ ...evaluation, planned: calls.planned }, review, { ...work, calls: { lines: calls.lines, carried: calls.carried } }),
    }))
  }

  // -- Calls (ticket 10) -------------------------------------------------------
  const callRunner = createCallRunner({
    store, bundles, options: callOptions, clock,
    linesAt: async (at) => (await workAt(at)).map((row) => row.calls),
    ended: callEnded,
  })

  /**
   * A call ended: the call proposals it carried are answered with its result, and
   * every change the person confirmed becomes a change proposal (needs a yes).
   * A callback answers nothing yet; the next attempt carries the same topics.
   */
  async function callEnded(call: Call): Promise<void> {
    if (call.outcome === "callback") return
    await recordCallResult(call)
    for (const change of call.changes) {
      await proposeChange({
        orderId: call.orderId, title: change.title, change: change.change, source: call.id,
        why: `${call.callee.name ?? call.callee.handle} said on the ${call.line} call at ${utcTime(call.endedAt ?? call.startedAt)}: ${change.claim}.`,
        contact: { name: call.callee.name ?? call.callee.handle, type: call.callee.contactType, role: call.line === "driver" ? "driver" : "site", recordId: call.callee.recordId },
      })
    }
  }

  /**
   * THE one place a finished call's result is written. Today: an "answered" event (with
   * the answer, question and who said it) on each call proposal the call carried.
   * Ticket 09: write the "call result recorded" effect event here (an attributed claim,
   * source = call.id; `call.claims` lists what the person said) and re-review the order.
   */
  async function recordCallResult(call: Call): Promise<void> {
    const answer = call.summary ?? call.outcome ?? "ended"
    const from = `${call.callee.name ?? call.callee.handle} (${call.line}), on call ${call.id}`
    for (const topic of call.topics) {
      if (topic.kind !== "proposal") continue
      const proposal = await findProposal(topic.id.slice("proposal:".length)).catch(() => null)
      if (!proposal || proposal.status === "answered" || proposal.status === "dismissed") continue
      const event = await eventFor(proposal, "answered", `Call result (${call.id}): ${answer}`, { answer, question: proposal.script, from })
      await store.appendProposalEvents([{ ...event, by: "agent" }])
    }
  }

  async function proposeChange(command: Extract<Command, { type: "proposeChange" }> | Omit<Extract<Command, { type: "proposeChange" }>, "type">): Promise<void> {
    const bundle = bundles.get(command.orderId)
    if (!bundle) throw new Error(`Unknown order ${command.orderId}`)
    const draft = changeDraft(bundle, command, await clock())
    if ((await store.readProposalEvents()).some((event) => event.proposalId === draft.id)) return
    await store.appendProposalEvents([{
      proposalId: draft.id, orderId: draft.orderId, at: draft.proposedAt, by: "agent", kind: "proposed", text: draft.action, data: { draft },
    }])
  }

  async function findProposal(proposalId: string): Promise<Proposal> {
    for (const order of await ordersAt(await clock())) {
      const found = order.proposals.find((proposal) => proposal.id === proposalId)
      if (found) return found
    }
    throw new Error(`No proposal ${proposalId}`)
  }

  /** A stored event; the first one for a finding's proposal keeps a copy of its draft (see proposals.ts). */
  async function eventFor(proposal: Proposal, kind: StoredProposalEvent["kind"], text: string, data: StoredProposalEvent["data"] = null): Promise<StoredProposalEvent> {
    const stored = (await store.readProposalEvents()).some((event) => event.proposalId === proposal.id)
    const draft = stored ? undefined : toDraft(proposal)
    return {
      proposalId: proposal.id, orderId: proposal.orderId, at: await clock(), by: "operator", kind, text,
      data: draft || data ? { ...(data ?? {}), ...(draft ? { draft } : {}) } : null,
    }
  }

  function toDraft(proposal: Proposal) {
    const { status: _s, waitingOn: _w, onApprove: _o, instructions: _i, answer: _a, history, ...rest } = proposal
    return { ...rest, proposedAt: history[0]?.at ?? start }
  }

  const OPEN: Proposal["status"][] = ["proposed", "approved"]

  function approvable(proposal: Proposal): void {
    if (proposal.status !== "proposed") throw new Error(`${proposal.reference}: "${proposal.title}" is ${proposal.status}; only a proposal waiting for a yes can be approved`)
  }

  function stillOpen(proposal: Proposal, doing: string): void {
    if (!OPEN.includes(proposal.status) || proposal.waitingOn === null) throw new Error(`${proposal.reference}: "${proposal.title}" is ${proposal.status} and decided; it cannot be ${doing}`)
  }

  function approvalText(proposal: Proposal): string {
    return proposal.kind === "customer_contact" ? `Approved: the contact with ${proposal.contact.name} is handed to the operator.`
      : proposal.kind === "change" ? `Approved: ${proposal.change}`
      : "Approved."
  }

  /** Instructions and answers are part of the order's case file: re-review the order with them. */
  async function rereview(orderId: string): Promise<void> {
    reviews.forget(orderId)
    if (reviews.canReview) await reviews.run(reviewInputs(eventsByOrder(await store.readProposalEvents())), [orderId])
  }

  function answerText(answer: string): string {
    const text = answer.trim()
    if (!text) throw new Error("The answer cannot be empty")
    return text
  }

  async function clock(): Promise<string> {
    return (await store.readClock()) ?? start
  }

  async function state(now?: Date | string): Promise<EngineState> {
    const at = now === undefined ? await clock() : isoOf(now)
    const orders = await ordersAt(at)
    const groupCounts = Object.fromEntries(GROUPS.map((group) => [group, orders.filter((row) => row.group === group).length])) as GroupCounts
    const items = await allDueItems()
    return {
      now: at, snapshotAt: start, orders, groupCounts, dueItems: dueAsOf(items, at), nextDueAt: nextDueAfter(items, at),
      reviews: reviewTotals(reviews.canReview, orders.map((row) => row.review)),
      briefing: briefingAsOf(await store.readBriefing(), at),
    }
  }

  // -- Briefing (ticket 13) --------------------------------------------------
  // Pushes: an order is "newly urgent" for a reason it was not urgent for at the start
  // (the 09:00 digest covers those). At most one push per order per reason (store id).
  let urgentAtStart: Set<string> | null = null
  const urgencyKeys = (evaluations: Map<string, Evaluation>) => new Set([...evaluations]
    .flatMap(([orderId, evaluation]) => evaluation.urgency.reasons.map((reason) => pushId({ orderId, reason: reason.kind }))))

  async function deliverPushes(now: string, delivered: Set<string>): Promise<void> {
    urgentAtStart ??= urgencyKeys(evaluationsAt(start))
    const evaluations = evaluationsAt(now)
    for (const bundle of snapshot.bundles) {
      const urgency = evaluations.get(bundle.order.id)!.urgency
      const seen = new Set<string>()
      for (const reason of urgency.reasons) {
        const push: PushInput = { orderId: bundle.order.id, reference: bundle.order.reference, reason: reason.kind, text: reason.text, at: now, dueAt: reason.at }
        const id = pushId(push)
        if (seen.has(id) || urgentAtStart.has(id) || delivered.has(id)) continue
        seen.add(id)
        await sendPush(store, push)
      }
    }
  }

  async function deliverDigests(now: string, delivered: Set<string>): Promise<void> {
    const items = await allDueItems()
    for (const [index, slot] of digestSlots.entries()) {
      const id = `digest:${slot.slot}`
      if (slot.at > now || delivered.has(id)) continue
      const previous = index > 0 ? digestSlots[index - 1] : null
      const facts = digestFacts({
        slot: slot.slot,
        at: slot.at,
        orders: await ordersAt(slot.at),
        previous: previous ? { at: previous.at, orders: await ordersAt(previous.at) } : null,
        cameDue: previous ? items.filter((item) => item.kind !== "digest" && item.at > previous.at && item.at <= slot.at)
          .sort((a, b) => a.at.localeCompare(b.at) || (a.reference ?? "").localeCompare(b.reference ?? ""))
          .map((item) => ({ title: item.title, orderId: item.orderId, reference: item.reference, at: item.at })) : [],
      })
      const digest: DigestItem = {
        id, kind: "digest", at: slot.at, read: false, deliveredAt: new Date().toISOString(), title: slot.title, slot: slot.slot,
        facts, prose: await writeProse(facts, proseOptions),
      }
      await store.addBriefing(digest)
    }
  }

  // One delivery at a time per process; the store's ids keep it at-most-once across processes.
  let delivering: Promise<void> = Promise.resolve()
  function deliverBriefing(): Promise<void> {
    const run = delivering.then(async () => {
      const now = await clock()
      const delivered = new Set((await store.readBriefing()).map((item) => item.id))
      await deliverPushes(now, delivered)
      await deliverDigests(now, delivered)
    })
    delivering = run.catch(() => {})
    return run
  }

  /** Every due-item source: next checks, the Briefing digests and the callbacks calls scheduled. */
  async function allDueItems(): Promise<Omit<DueItem, "due">[]> {
    const calls = [...(await callRunner.read()).values()].flat()
    return [...nextChecks, ...digestItems, ...callbackItems(calls)]
  }

  async function apply(command: Command): Promise<EngineState> {
    switch (command.type) {
      case "advanceClock": {
        if (!Number.isFinite(command.minutes) || command.minutes <= 0) {
          throw new Error(`The clock only moves forward: got ${command.minutes} minutes`)
        }
        const from = new Date(await clock()).getTime()
        await store.writeClock(new Date(from + command.minutes * MINUTE).toISOString())
        await deliverBriefing()
        break
      }
      case "advanceToNextDue": {
        const next = nextDueAfter(await allDueItems(), await clock())
        if (!next) throw new Error("Nothing is due later on the demo clock")
        await store.writeClock(next)
        await deliverBriefing()
        break
      }
      case "reset": {
        // Instructions and answers were part of those orders' case files: read their reviews afresh.
        const touched = new Set((await store.readProposalEvents()).map((event) => event.orderId))
        await store.reset()
        for (const orderId of touched) reviews.forget(orderId)
        await deliverBriefing()
        break
      }
      case "review":
        await reviews.run(reviewInputs(eventsByOrder(await store.readProposalEvents())), command.orderIds)
        break
      case "approve": {
        const proposal = await findProposal(command.proposalId)
        approvable(proposal)
        await store.appendProposalEvents([await eventFor(proposal, "approved", approvalText(proposal))])
        break
      }
      case "approveBatch": {
        const proposals = await Promise.all([...new Set(command.proposalIds)].map(findProposal))
        proposals.forEach(approvable)
        await store.appendProposalEvents(await Promise.all(proposals.map((proposal) => eventFor(proposal, "approved", approvalText(proposal)))))
        break
      }
      case "editScript": {
        const script = command.script.trim()
        if (!script) throw new Error("The script cannot be empty")
        const proposal = await findProposal(command.proposalId)
        stillOpen(proposal, "edited")
        if (script === proposal.script) break
        await store.appendProposalEvents([await eventFor(proposal, "edited", `Script changed from "${proposal.script}" to "${script}".`, { script })])
        break
      }
      case "dismiss": {
        const proposal = await findProposal(command.proposalId)
        stillOpen(proposal, "dismissed")
        const note = command.note?.trim()
        await store.appendProposalEvents([await eventFor(proposal, "dismissed", note ? `Dismissed: ${note}` : "Dismissed.")])
        break
      }
      case "instruct": {
        const text = command.text.trim()
        if (!text) throw new Error("The instruction cannot be empty")
        const proposal = await findProposal(command.proposalId)
        await store.appendProposalEvents([await eventFor(proposal, "instructed", text, { title: proposal.title })])
        await rereview(proposal.orderId)
        break
      }
      case "recordAnswer": {
        const answer = answerText(command.answer)
        const proposal = await findProposal(command.proposalId)
        if (proposal.kind !== "customer_contact") throw new Error(`${proposal.reference}: "${proposal.title}" is not a customer-side contact; only those take a customer's answer`)
        if (proposal.status !== "approved") throw new Error(`${proposal.reference}: "${proposal.title}" is ${proposal.status}; approve it and make the contact before recording the answer`)
        const name = proposal.contact.name
        const update = changeDraft(bundles.get(proposal.orderId)!, {
          title: `Update the order from the ${proposal.contact.typeLabel.toLowerCase()}'s answer`,
          change: `Record the answer on the order: "${answer}"`,
          why: `The operator asked "${proposal.script}" and recorded this answer.`,
          source: proposal.id, evidence: proposal.evidence, whoPays: proposal.whoPays,
          contact: { name, type: proposal.contact.type, role: proposal.contact.role, recordId: proposal.contact.recordId },
        }, await clock())
        const from = `${name} (${proposal.contact.typeLabel.toLowerCase()}), recorded by the operator`
        await store.appendProposalEvents([
          await eventFor(proposal, "answered", `Answer recorded: ${answer}`, { answer, question: proposal.script, from }),
          { proposalId: update.id, orderId: update.orderId, at: update.proposedAt, by: "agent", kind: "proposed", text: update.action, data: { draft: update } },
        ])
        await rereview(proposal.orderId)
        break
      }
      case "answerQuestion": {
        const answer = answerText(command.answer)
        const proposal = await findProposal(command.proposalId)
        if (proposal.kind !== "operator_question") throw new Error(`${proposal.reference}: "${proposal.title}" is not a question to the operator`)
        stillOpen(proposal, "answered")
        await store.appendProposalEvents([await eventFor(proposal, "answered", `Answered: ${answer}`, { answer, question: proposal.script, from: "operator" })])
        await rereview(proposal.orderId)
        break
      }
      case "proposeChange":
        await proposeChange(command)
        break
      case "runCalls":
        await callRunner.run(command.steps)
        break
      case "startCall":
        await callRunner.start(command.orderId, command.line, command.live ? "live" : undefined)
        break
      case "callEvent":
        await callRunner.input(command.callId, command.input)
        break
      case "voiceTurn":
        await callRunner.voice(command.callId, command.audio)
        break
      case "deliverBriefing":
        await deliverBriefing()
        break
      case "markBriefingRead":
        await store.markBriefingRead(command.ids)
        break
      default:
        assertNever(command)
    }
    return state()
  }

  return { state, apply, clock, bundle: (orderId) => bundles.get(orderId) ?? null, phone: (persona) => callRunner.phone(persona) }
}
