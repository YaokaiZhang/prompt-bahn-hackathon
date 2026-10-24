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
import { compareUrgency, GROUPS, verdictFor, type Group, type RuleResult, type Verdict } from "./checks"
import { createReviewLayer, reviewTotals, type OrderReview, type ReviewOptions, type ReviewTotals } from "./reviews"
import { buildFleet, evaluateRules, type Evaluation } from "./rules"
import type { EngineStore } from "./store"

/** The snapshot as the engine reads it: one bundle per order. */
export type Snapshot = { snapshotAt: string; bundles: Bundle[] }

export type Command =
  | { type: "advanceClock"; minutes: number }
  | { type: "reset" }
  /** Runs the reviewer on the orders not reviewed yet (all, or `orderIds`). The seed sweep sends this. */
  | { type: "review"; orderIds?: string[] }

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
  /** The reviewer's read of the order (ticket 06); its findings feed `group`. */
  review: OrderReview
} & Verdict

export type GroupCounts = Record<Group, number>

export type { CitedRecord, OrderReview, ReviewFinding, ReviewTotals, ReviewTrigger } from "./reviews"
export type { FirstAction, Group, Outcome, PlannedAction, RuleId, RuleResult, SourceRef, Urgency } from "./checks"
export { GROUPS }

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

  async function ordersAt(at: string): Promise<OrderState[]> {
    const evaluations = evaluationsAt(at)
    const read = await reviews.read(rulesAtReview)
    return snapshot.bundles.map((bundle) => {
      const review = read.get(bundle.order.id)!
      return {
        id: bundle.order.id,
        reference: bundle.order.reference,
        status: bundle.order.status,
        review,
        ...verdictFor(evaluations.get(bundle.order.id)!, review),
      }
    })
  }

  async function clock(): Promise<string> {
    return (await store.readClock()) ?? start
  }

  async function state(now?: Date | string): Promise<EngineState> {
    const at = now === undefined ? await clock() : isoOf(now)
    const orders = await ordersAt(at)
    const groupCounts = Object.fromEntries(GROUPS.map((group) => [group, orders.filter((row) => row.group === group).length])) as GroupCounts
    return { now: at, snapshotAt: start, orders, groupCounts, reviews: reviewTotals(reviews.canReview, orders.map((row) => row.review)) }
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
      case "reset":
        await store.reset()
        break
      case "review":
        await reviews.run(rulesAtReview, command.orderIds)
        break
      default:
        assertNever(command)
    }
    return state()
  }

  return { state, apply, clock, bundle: (orderId) => bundles.get(orderId) ?? null }
}
