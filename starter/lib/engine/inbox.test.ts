// The support inbox's own state (inbox.ts) and the inbox agent (inbox-agent.ts): the
// operator links orders and sends replies through `apply`; the overlay shows them on the
// threads; the agent suggests from the thread and its orders, falling back to a template.

import assert from "node:assert/strict"
import { test } from "node:test"
import { DEMO_INBOX_MESSAGES, DEMO_INBOX_THREADS } from "@/lib/present/inbox-demo"
import type { Step } from "@/lib/present/situation"
import { applyInboxEvents, operatorLinks } from "./inbox"
import { createMemorySuggestionCache, parseSuggestion, suggestForThread, type SuggestInput } from "./inbox-agent"
import { eachStore, failingGateway, proseGateway, testSnapshot } from "./testing"

const HAMBURG = DEMO_INBOX_THREADS.find((thread) => thread.id === "inbox-demo-hamburg")!
// CD-420458: the Kovellin order collecting at Calverona Hamburg, the demo thread's candidate.
const ORDER_458 = "ord-00458"

eachStore("the operator links an order, sends a reply and takes the link back", async (engine) => {
  await engine.apply({ type: "linkThread", threadId: HAMBURG.id as string, orderId: ORDER_458 })
  await assert.rejects(engine.apply({ type: "linkThread", threadId: HAMBURG.id as string, orderId: ORDER_458 }), /CD-420458 is already linked/)
  await assert.rejects(engine.apply({ type: "linkThread", threadId: HAMBURG.id as string, orderId: "ord-99999" }), /Unknown order/)
  await engine.apply({ type: "replyThread", threadId: HAMBURG.id as string, text: "  Bitte senden Sie die Freigabe.  ", suggested: true })
  await assert.rejects(engine.apply({ type: "replyThread", threadId: HAMBURG.id as string, text: "   " }), /empty/)

  const events = await engine.inboxEvents()
  assert.deepEqual(events.map((event) => event.kind), ["linked", "replied"])
  assert.equal(events[0].at, await engine.clock())
  const { threads, messages } = applyInboxEvents([HAMBURG], DEMO_INBOX_MESSAGES, events)
  assert.deepEqual(threads[0].linked_order_ids, [ORDER_458])
  assert.deepEqual(threads[0].operator_linked_order_ids, [ORDER_458])
  assert.equal(threads[0].link_state, "CONFIRMED_SINGLE")
  assert.equal(threads[0].waiting_on, null, "the link answers the missing reference")
  const reply = messages.find((message) => message.thread_id === HAMBURG.id && message.author_type === "operator")
  assert.equal(reply?.body, "Bitte senden Sie die Freigabe.")
  assert.equal(reply?.recipient_id, "cus-030")
  assert.equal(reply?.drafted_by_agent, true)

  await engine.apply({ type: "unlinkThread", threadId: HAMBURG.id as string, orderId: ORDER_458 })
  await assert.rejects(engine.apply({ type: "unlinkThread", threadId: HAMBURG.id as string, orderId: ORDER_458 }), /was not linked from the inbox/)
  assert.deepEqual(operatorLinks(await engine.inboxEvents(), HAMBURG.id as string), [])
  const back = applyInboxEvents([HAMBURG], [], await engine.inboxEvents()).threads[0]
  assert.equal(back.link_state, "PENDING_MATCH", "with no link left the thread is as seeded")

  await engine.apply({ type: "reset" })
  assert.deepEqual(await engine.inboxEvents(), [], "reset clears the operator's inbox events")
})

test("the demo threads name real orders, customers and drivers of the snapshot", async () => {
  const snapshot = await testSnapshot()
  const orders = new Map(snapshot.bundles.map((bundle) => [bundle.order.id, bundle]))
  for (const thread of DEMO_INBOX_THREADS) {
    for (const id of [...(thread.linked_order_ids as string[]), ...(thread.candidate_order_ids as string[])]) assert.ok(orders.has(id), `${thread.id}: ${id}`)
    if (thread.counterparty_type === "customer") {
      for (const id of thread.linked_order_ids as string[]) assert.equal(orders.get(id)!.customer.id, thread.counterparty_id, `${thread.id} is the order's customer`)
    }
    assert.ok(DEMO_INBOX_MESSAGES.some((message) => message.thread_id === thread.id), `${thread.id} has a message`)
  }
})

// ── The agent ────────────────────────────────────────────────────────────────

const accept: Step = { label: "Accept the proof", do: "close", records: [{ collection: "proofs", recordId: "proof-1" }] }
const review: Step = { label: "Review the open records", do: "open", anchor: "rule-CLOSE" }
const open: Step = { label: "Open the order", do: "open", anchor: "checks", full: true }

const linked: SuggestInput = {
  now: "2026-10-21T09:00:00.000Z",
  thread: { id: "t1", category: "document_request", channel: "email", linkState: "CONFIRMED_SINGLE", waitingOn: null, basis: null, sender: { name: "Auvelloria Motor Collection", role: "customer" } },
  messages: [{ from: "sender", at: "2026-10-21T08:36:00Z", body: "Can you confirm the proof of delivery for CD-420904 has been accepted?", language: "en" }],
  orders: [{
    orderId: "ord-00904", reference: "CD-420904", status: "DELIVERED", group: "needs_action", reason: "Proof waits for review", car: "Audi RS 6",
    from: "Helsinki, FI", to: "Vantaa, FI", pickupWindow: null, deliveryWindow: null, headline: "Delivered, proof waits for review", body: null, steps: [review, accept, open],
  }],
}
const unlinked: SuggestInput = { ...linked, thread: { ...linked.thread, linkState: "PENDING_IDENTITY", sender: { name: "Tilda Birkelane", role: "driver" } }, orders: [] }

test("without a model the template answers: ask for the reference, or the order's own steps", async () => {
  const none = await suggestForThread(unlinked)
  assert.equal(none.source, "template")
  assert.match(none.fallback ?? "", /no model key/)
  assert.match(none.reply, /^Hello Tilda,/)
  assert.match(none.reply, /order reference from your own booking/)
  assert.deepEqual(none.orders, [])

  const withOrder = await suggestForThread(linked)
  assert.match(withOrder.reply, /CD-420904/)
  assert.deepEqual(withOrder.orders[0].steps.map((step) => step.label), ["Review the open records", "Accept the proof", "Open the order"])
})

test("the model's picks come first, with its reason; a repeat is cached", async () => {
  const gateway = proseGateway({ reply: "Hello, we are reviewing the proof for CD-420904 now.\n\nSupport desk", note: "Accept the proof.", picks: [{ order: 0, step: 1, why: "The customer waits on it." }] } as never)
  const cache = createMemorySuggestionCache()
  const first = await suggestForThread(linked, { gateway, cache })
  assert.equal(first.source, "model")
  assert.deepEqual(first.orders[0].steps.map((step) => step.label), ["Accept the proof", "Review the open records", "Open the order"])
  assert.equal(first.orders[0].why, "The customer waits on it.")
  const again = await suggestForThread(linked, { gateway, cache })
  assert.equal(again.cached, true)
  assert.equal(gateway.calls.length, 1)
})

test("a made-up number, an unknown step or a failed call falls back to the template", async () => {
  assert.throws(() => parseSuggestion(JSON.stringify({ reply: "It arrives at 15:30.", picks: [] }), linked), /names 15/)
  assert.throws(() => parseSuggestion(JSON.stringify({ reply: "Hello.", picks: [{ order: 0, step: 7 }] }), linked), /names no step/)
  assert.throws(() => parseSuggestion("not json", linked), /not JSON/)
  const invented = await suggestForThread(linked, { gateway: proseGateway(JSON.stringify({ reply: "Your car comes on CD-421999.", picks: [] })) })
  assert.equal(invented.source, "template")
  assert.match(invented.fallback ?? "", /rejected \(the draft names 421999/)
  const failed = await suggestForThread(linked, { gateway: failingGateway("blocked") })
  assert.match(failed.fallback ?? "", /the model call failed/)
})
