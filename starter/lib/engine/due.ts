// Due items: things that happen when the demo clock reaches a time. The clock's
// "Next due item" control jumps to the earliest one still ahead.
//
// Firing is level-based, not stored: an item is due when `at <= now`. Reading the
// engine as of any time (`state(t)`) therefore gives the same answer as moving the
// clock there, and reset undoes every firing by putting the clock back.
//
// Sources today: next checks recorded in the snapshot (open conversations with
// `next_check_at`). Ticket 10 adds callbacks (from the store), ticket 13 the
// digests at 09:00, 12:00 and 16:00: add a `DueKind`, build the items, and list
// them in `allDueItems` in engine.ts. What an item *does* when due belongs to the
// rules (a next check is rule NEXT in rules.ts) or to the source's own ticket.

import type { Bundle } from "@/lib/present/bundle"
import { str } from "@/lib/present/bundle"

export type DueKind = "next_check" | "digest"

export type DueItem = {
  /** Stable id: `<kind>:<source record id>`. */
  id: string
  kind: DueKind
  /** When it comes due, ISO. */
  at: string
  /** The order it belongs to; null for fleet-wide items (a digest). */
  orderId: string | null
  reference: string | null
  /** What comes due, short: "Next check". */
  title: string
  /** More about it, e.g. "waiting on stock control reply"; null when there is nothing to add. */
  detail: string | null
  /** One line: title, order reference and detail. */
  label: string
  /** True once the clock has reached `at`. */
  due: boolean
}

const humanise = (code: string) => code.toLowerCase().replace(/_/g, " ")

/** A next check recorded on an open conversation filed under this order. */
export type NextCheck = { conversationId: string; at: string; waitingOn: string | null; category: string; counterpartyType: string | null }

export function nextChecksOf(bundle: Bundle): NextCheck[] {
  const checks: NextCheck[] = []
  for (const thread of bundle.conversations) {
    const at = str(thread.details.next_check_at)
    if (thread.orderId !== bundle.order.id || thread.status !== "OPEN" || !at) continue
    checks.push({
      conversationId: thread.id,
      at: new Date(at).toISOString(),
      waitingOn: str(thread.details.waiting_on),
      category: thread.category,
      counterpartyType: str(thread.details.counterparty_type),
    })
  }
  return checks.sort((a, b) => a.at.localeCompare(b.at))
}

/** Every next check in the snapshot as a due item (not yet marked due). */
export function nextCheckItems(bundles: Bundle[]): Omit<DueItem, "due">[] {
  return bundles.flatMap((bundle) => nextChecksOf(bundle).map((check) => ({
    id: `next_check:${check.conversationId}`,
    kind: "next_check" as const,
    at: check.at,
    orderId: bundle.order.id,
    reference: bundle.order.reference,
    title: "Next check",
    detail: check.waitingOn ? `waiting on ${humanise(check.waitingOn)}` : null,
    label: `Next check on ${bundle.order.reference}${check.waitingOn ? `: waiting on ${humanise(check.waitingOn)}` : ""}`,
  })))
}

/** The Briefing digests of the demo day (ticket 13); the 09:00 one is due at the start. */
export function digestDueItems(slots: { slot: string; at: string; title: string }[]): Omit<DueItem, "due">[] {
  return slots.map(({ slot, at, title }) => ({
    id: `digest:${slot}`, kind: "digest" as const, at, orderId: null, reference: null, title, detail: null, label: `${title} in the Briefing`,
  }))
}

/** Marks items due as of `now` and sorts them by time, then order reference. */
export function dueAsOf(items: Omit<DueItem, "due">[], now: string): DueItem[] {
  return items
    .map((item) => ({ ...item, due: item.at <= now }))
    .sort((a, b) => a.at.localeCompare(b.at) || (a.reference ?? "").localeCompare(b.reference ?? "") || a.id.localeCompare(b.id))
}

/** The earliest time an item comes due after `now`, or null when nothing is left. */
export function nextDueAfter(items: Pick<DueItem, "at">[], now: string): string | null {
  return items.map((item) => item.at).filter((at) => at > now).sort()[0] ?? null
}

/** The items that came due on a clock move from `from` to `state.now`. */
export function becameDue(state: { now: string; dueItems: DueItem[] }, from: string): DueItem[] {
  const since = new Date(from).toISOString()
  return state.dueItems.filter((item) => item.at > since && item.at <= state.now)
}
