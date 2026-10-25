// The support inbox's own state: what the operator did on a thread. Linking an order
// and sending a reply are inbox events, appended to `cr_inbox_events` and laid over the
// inbox records (ADR 0002: the records are never edited). Reset clears them; the threads
// and their messages stay.
//
//   linked     the operator linked an order to the thread (`orderId`)
//   unlinked   the operator took back an order they linked
//   replied    the operator sent `text` to the sender (`data.suggested`: it began as the agent's draft)
//
// Pure: `applyInboxEvents` reads raw thread and message rows and returns new ones.

import type { Row } from "@/lib/present/types"

export type InboxEventKind = "linked" | "unlinked" | "replied"

export type InboxEvent = {
  threadId: string
  orderId: string | null
  at: string
  by: "operator"
  kind: InboxEventKind
  text: string
  data: { suggested?: boolean } | null
}

/** The operator's support mailbox: replies go out from it, like the seeded ones. */
export const SUPPORT_DESK = "ops-support"
export const MAX_REPLY = 4000

const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

/** The orders the operator linked to a thread and has not taken back, oldest first. */
export function operatorLinks(events: InboxEvent[], threadId: string): string[] {
  const linked: string[] = []
  for (const event of events) {
    if (event.threadId !== threadId || !event.orderId) continue
    if (event.kind === "linked" && !linked.includes(event.orderId)) linked.push(event.orderId)
    if (event.kind === "unlinked" && linked.includes(event.orderId)) linked.splice(linked.indexOf(event.orderId), 1)
  }
  return linked
}

/**
 * The threads and messages with the operator's events laid over them. A linked order joins
 * `linked_order_ids` (and `operator_linked_order_ids`, so the inbox can offer to take it
 * back); the thread then counts as linked. A reply becomes a message from the support desk
 * to the sender, on the thread's channel.
 */
export function applyInboxEvents(threads: Row[], messages: Row[], events: InboxEvent[]): { threads: Row[]; messages: Row[] } {
  const replies: Row[] = []
  const out = threads.map((thread) => {
    const id = String(thread.id)
    const mine = events.filter((event) => event.threadId === id)
    if (!mine.length) return thread
    const added = operatorLinks(mine, id)
    const seeded = ids(thread.linked_order_ids)
    const linked = [...seeded, ...added.filter((orderId) => !seeded.includes(orderId))]
    const last = mine[mine.length - 1]
    const next: Row = { ...thread, updated_at: [String(thread.updated_at ?? ""), last.at].sort().at(-1) }
    if (added.length) {
      const lastLink = [...mine].reverse().find((event) => event.kind === "linked" && event.orderId && added.includes(event.orderId))
      Object.assign(next, {
        linked_order_ids: linked,
        operator_linked_order_ids: added.filter((orderId) => !seeded.includes(orderId)),
        link_state: linked.length > 1 ? "CONFIRMED_MULTI" : "CONFIRMED_SINGLE",
        // The operator's link answers what the thread was waiting on to be matched.
        waiting_on: ["SENDER_CORRECTION", "DRIVER_DUTY_REFERENCE", "ORDER_REFERENCE"].includes(String(thread.waiting_on)) ? null : thread.waiting_on,
        resolution: { decision: "OPERATOR_LINKED", decided_at: lastLink?.at ?? last.at, evidence_message_id: null },
      })
    }
    mine.filter((event) => event.kind === "replied").forEach((event, index) => replies.push({
      id: `${id}-reply-${index + 1}`, thread_id: id, author_id: SUPPORT_DESK, author_type: "operator",
      recipient_id: thread.counterparty_id ?? null, recipient_type: thread.counterparty_type ?? null,
      channel: thread.channel, authored_at: event.at, body: event.text, visibility: "PUBLIC", language: null,
      sent_from_app: true, drafted_by_agent: event.data?.suggested === true,
    }))
    return next
  })
  return { threads: out, messages: [...messages, ...replies] }
}
