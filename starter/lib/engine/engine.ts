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
import { becameDue, dueAsOf, nextCheckItems, nextDueAfter, type DueItem } from "./due"
import {
  changeDraft, instructionsFor, proposalsFor, type OrderProposals, type Proposal, type StoredProposalEvent, type Unreachable,
} from "./proposals"
import { createReviewLayer, reviewTotals, type OrderReview, type ReviewInputs, type ReviewOptions, type ReviewTotals } from "./reviews"
import { buildFleet, evaluateRules, type Evaluation } from "./rules"
import type { EngineStore } from "./store"

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
} & Verdict

export type GroupCounts = Record<Group, number>

export type { CitedRecord, OrderReview, ReviewFinding, ReviewTotals, ReviewTrigger } from "./reviews"
export type { Proposal, ProposalEvent, ProposalKind, ProposalStatus, Unreachable } from "./proposals"
export type { FirstAction, Group, Outcome, PlannedAction, RuleId, RuleResult, SourceRef, Urgency } from "./checks"
export type { DueItem, DueKind } from "./due"
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
}

export type Engine = {
  state(now?: Date | string): Promise<EngineState>
  apply(command: Command): Promise<EngineState>
  /** The demo clock as stored, as an ISO string. */
  clock(): Promise<string>
  /** The bundle the engine reads for one order, or null for an unknown id. */
  bundle(orderId: string): Bundle | null
}

export type EngineDeps = {
  snapshot: Snapshot
  store: EngineStore
  /** The reviewer's gateway, cache and inbox messages. Absent: every order "not reviewed yet". */
  reviews?: ReviewOptions
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

export function createEngine({ snapshot, store, reviews: reviewOptions }: EngineDeps): Engine {
  const start = isoOf(snapshot.snapshotAt)
  const bundles = new Map(snapshot.bundles.map((bundle) => [bundle.order.id, bundle]))
  const fleet = buildFleet(snapshot.bundles)
  const reviews = createReviewLayer(snapshot.bundles, start, reviewOptions)
  const nextChecks = nextCheckItems(snapshot.bundles)
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
        const instructions = instructionsFor(events.get(bundle.order.id) ?? [])
        return instructions.length ? { instructions } : undefined
      },
    }
  }

  async function ordersAt(at: string): Promise<OrderState[]> {
    const evaluations = evaluationsAt(at)
    const events = eventsByOrder(await store.readProposalEvents())
    const read = await reviews.read(reviewInputs(events))
    return snapshot.bundles.map((bundle) => {
      const review = read.get(bundle.order.id)!
      const work: OrderProposals = proposalsFor(bundle, review, events.get(bundle.order.id) ?? [])
      return {
        id: bundle.order.id,
        reference: bundle.order.reference,
        status: bundle.order.status,
        review,
        proposals: work.proposals,
        unreachable: work.unreachable,
        ...verdictFor(evaluations.get(bundle.order.id)!, review, work),
      }
    })
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
    const { status: _s, waitingOn: _w, onApprove: _o, instructions: _i, history, ...rest } = proposal
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
    }
  }

  /** Every due-item source. Callbacks (ticket 10) and digests (ticket 13) go here. */
  async function allDueItems(): Promise<Omit<DueItem, "due">[]> {
    return nextChecks
  }

  async function apply(command: Command): Promise<EngineState> {
    switch (command.type) {
      case "advanceClock": {
        if (!Number.isFinite(command.minutes) || command.minutes <= 0) {
          throw new Error(`The clock only moves forward: got ${command.minutes} minutes`)
        }
        const from = new Date(await clock()).getTime()
        await store.writeClock(new Date(from + command.minutes * MINUTE).toISOString())
        break
      }
      case "advanceToNextDue": {
        const next = nextDueAfter(await allDueItems(), await clock())
        if (!next) throw new Error("Nothing is due later on the demo clock")
        await store.writeClock(next)
        break
      }
      case "reset":
        await store.reset()
        break
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
        // The instruction is part of the order's case file: re-review the order with it.
        reviews.forget(proposal.orderId)
        if (reviews.canReview) await reviews.run(reviewInputs(eventsByOrder(await store.readProposalEvents())), [proposal.orderId])
        break
      }
      case "proposeChange": {
        const bundle = bundles.get(command.orderId)
        if (!bundle) throw new Error(`Unknown order ${command.orderId}`)
        const draft = changeDraft(bundle, command, await clock())
        if ((await store.readProposalEvents()).some((event) => event.proposalId === draft.id)) break
        await store.appendProposalEvents([{
          proposalId: draft.id, orderId: draft.orderId, at: draft.proposedAt, by: "agent", kind: "proposed", text: draft.action, data: { draft },
        }])
        break
      }
      default:
        assertNever(command)
    }
    return state()
  }

  return { state, apply, clock, bundle: (orderId) => bundles.get(orderId) ?? null }
}
