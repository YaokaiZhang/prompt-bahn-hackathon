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
import { compareUrgency, GROUPS, verdictFor, type Group, type Verdict } from "./checks"
import { becameDue, dueAsOf, nextCheckItems, nextDueAfter, type DueItem } from "./due"
import { buildFleet } from "./rules"
import type { EngineStore } from "./store"

/** The snapshot as the engine reads it: one bundle per order. */
export type Snapshot = { snapshotAt: string; bundles: Bundle[] }

export type Command =
  /** "+15 min" in the demo controls; any positive number of minutes. */
  | { type: "advanceClock"; minutes: number }
  /** "Next due item": jump to the earliest due item after the clock; refused when none is left. */
  | { type: "advanceToNextDue" }
  | { type: "reset" }

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
} & Verdict

export type GroupCounts = Record<Group, number>

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

export function createEngine({ snapshot, store }: EngineDeps): Engine {
  const start = isoOf(snapshot.snapshotAt)
  const bundles = new Map(snapshot.bundles.map((bundle) => [bundle.order.id, bundle]))
  const fleet = buildFleet(snapshot.bundles)
  const nextChecks = nextCheckItems(snapshot.bundles)
  // Rules re-run only when the time read changes (load, clock move); effect
  // events (ticket 09) must clear this too.
  let last: { at: string; orders: OrderState[] } | null = null

  function ordersAt(at: string): OrderState[] {
    if (last?.at === at) return last.orders
    const orders = snapshot.bundles.map((bundle) => ({
      id: bundle.order.id,
      reference: bundle.order.reference,
      status: bundle.order.status,
      ...verdictFor(bundle, { now: at, fleet }),
    }))
    last = { at, orders }
    return orders
  }

  async function clock(): Promise<string> {
    return (await store.readClock()) ?? start
  }

  async function state(now?: Date | string): Promise<EngineState> {
    const at = now === undefined ? await clock() : isoOf(now)
    const orders = ordersAt(at)
    const groupCounts = Object.fromEntries(GROUPS.map((group) => [group, orders.filter((row) => row.group === group).length])) as GroupCounts
    const items = await allDueItems()
    return { now: at, snapshotAt: start, orders, groupCounts, dueItems: dueAsOf(items, at), nextDueAt: nextDueAfter(items, at) }
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
      default:
        assertNever(command)
    }
    return state()
  }

  return { state, apply, clock, bundle: (orderId) => bundles.get(orderId) ?? null }
}
