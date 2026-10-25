// The support inbox as the app reads it: the seeded threads and the demo threads
// (inbox-demo.ts), with the operator's inbox events laid over them (lib/engine/inbox.ts),
// read out by `buildInboxView`. The routes call this; the suggestion route also turns a
// thread into the inbox agent's input.

import "server-only"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { applyInboxEvents } from "@/lib/engine/inbox"
import type { SuggestInput, ThreadOrder } from "@/lib/engine/inbox-agent"
import { jobWindows } from "@/lib/engine/publishing"
import type { Engine } from "@/lib/engine/engine"
import { relatedRecords } from "@/lib/schema"
import { buildBoardCard } from "./board"
import { buildInboxView } from "./inbox"
import { DEMO_INBOX_MESSAGES, DEMO_INBOX_THREADS } from "./inbox-demo"
import { loadShared, orderRefs } from "./load"
import { openOrder, situationFor } from "./situation"
import type { InboxThreadView } from "./types"

const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

export async function loadInbox(engine: Engine) {
  const [threadRows, messageRows, shared, events] = await Promise.all([
    db.select().from(relatedRecords).where(eq(relatedRecords.collection, "support_inbox_threads")),
    db.select().from(relatedRecords).where(eq(relatedRecords.collection, "support_inbox_messages")),
    loadShared(),
    engine.inboxEvents(),
  ])
  const overlaid = applyInboxEvents(
    [...threadRows.map((row) => row.details), ...DEMO_INBOX_THREADS],
    [...messageRows.map((row) => row.details), ...DEMO_INBOX_MESSAGES],
    events,
  )
  const threads = overlaid.threads.sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
  const messages = overlaid.messages.sort((left, right) => String(left.authored_at).localeCompare(String(right.authored_at)))
  const refs = await orderRefs(threads.flatMap((thread) => [...ids(thread.candidate_order_ids), ...ids(thread.linked_order_ids)]))
  // The raw threads and messages keep their shape; `view` reads them out with names and references.
  const view = buildInboxView(threads, messages, shared.makeDirectory(), refs, shared.snapshotAt)
  return { threads, messages, view }
}

/** One linked order as the inbox agent reads it: the engine's verdict, its situation card's steps, the car and the route. */
async function threadOrder(engine: Engine, orders: Map<string, Awaited<ReturnType<Engine["state"]>>["orders"][number]>, orderId: string): Promise<ThreadOrder | null> {
  const order = orders.get(orderId)
  const snapshot = engine.bundle(orderId)
  if (!order || !snapshot) return null
  const bundle = await engine.overlaid(snapshot)
  const card = buildBoardCard(bundle)
  const situation = situationFor(order)
  const steps = situation ? [situation.step, ...situation.others].filter((step): step is NonNullable<typeof step> => step !== null) : []
  const windows = jobWindows(bundle)
  return {
    orderId, reference: order.reference, status: order.status, group: order.group, reason: order.reason,
    car: card.vehicle || null, from: card.origin, to: card.destination,
    pickupWindow: windows.pickup ? { start: windows.pickup.start, end: windows.pickup.end } : null,
    deliveryWindow: windows.delivery ? { start: windows.delivery.start, end: windows.delivery.end } : null,
    headline: situation?.headline ?? null, body: situation?.body ?? null,
    steps: steps.some((step) => step.label === openOrder.label) ? steps : [...steps, openOrder],
  }
}

/** The inbox agent's input for one thread: its messages and its linked orders as the engine reads them now. */
export async function suggestInput(engine: Engine, thread: InboxThreadView): Promise<SuggestInput> {
  const state = await engine.state()
  const orders = new Map(state.orders.map((order) => [order.id, order]))
  const linked = (await Promise.all(thread.linked.map((ref) => threadOrder(engine, orders, ref.id)))).filter((order): order is ThreadOrder => order !== null)
  return {
    now: state.now,
    thread: {
      id: thread.id, category: thread.category, channel: thread.channel, linkState: thread.linkState, waitingOn: thread.waitingOn,
      basis: thread.candidateBasis, sender: thread.counterparty ? { name: thread.counterparty.name, role: thread.counterparty.role ?? thread.counterparty.kind } : null,
    },
    messages: thread.messages.map((message) => ({
      from: message.internal ? "internal" as const : message.author.kind === "operator" ? "support" as const : "sender" as const,
      at: message.at, body: message.body, language: message.language,
    })),
    orders: linked,
  }
}
