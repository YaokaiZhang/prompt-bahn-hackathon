// Plain words for the situation cards: cached rewrites, background batches, and the
// number check that keeps the model from changing a time or a count.

import assert from "node:assert/strict"
import { test } from "node:test"
import { applyPlain, type Situation } from "@/lib/present/situation"
import { checkPlain, createMemoryPlainCache, createPlainWords, type PlainItem } from "./plain-words"
import { failingGateway, proseGateway } from "./testing"

const situation = (headline: string, body: string | null): Situation => ({ headline, body, step: null, others: [] })

const slot: PlainItem = {
  kind: "decide",
  situation: situation("Pickup slot passed, nothing collected", "The slot ended 21 Oct 11:00 EEST. Suggestion: hand you the contact with Pellavaro Auto (paying customer, cus-015)."),
}

const reply = (cards: unknown[]) => JSON.stringify({ cards })

test("a rewrite keeps the card's numbers and may drop ids", () => {
  const text = checkPlain({ headline: "Nobody collected the car.", body: "The pickup slot ended at 11:00 EEST on 21 Oct. Call Pellavaro Auto, the paying customer." }, slot)
  assert.deepEqual(text, { headline: "Nobody collected the car", body: "The pickup slot ended at 11:00 EEST on 21 Oct. Call Pellavaro Auto, the paying customer." })
})

test("a rewrite with a number the card does not have is rejected", () => {
  assert.throws(() => checkPlain({ headline: "Nobody collected the car", body: "The slot ended at 12:00." }, slot), /not in the card \(12\)/)
  assert.throws(() => checkPlain({ headline: "", body: "x" }, slot), /no headline/)
  assert.throws(() => checkPlain({ headline: "**Late**", body: null }, slot), /markup/)
  assert.throws(() => checkPlain({ headline: "Nobody collected the car", body: "Call Pellavaro Auto and ask her." }, slot), /gendered/)
})

test("lookup returns nothing at first, rewrites in the background, then serves the cache", async () => {
  const gateway = proseGateway(reply([{ id: "1", headline: "Nobody collected the car", body: "The slot ended at 11:00 EEST. Call Pellavaro Auto." }]))
  const service = createPlainWords({ gateway, cache: createMemoryPlainCache(), model: "m" })
  assert.equal((await service.lookup([slot])).size, 0)
  await service.fill([slot])
  assert.equal(gateway.calls.length, 1, "the background batch was already running; fill does not ask twice")
  assert.equal(gateway.calls[0].job, "plain-words")
  const found = (await service.lookup([slot])).get(0)
  assert.equal(found?.headline, "Nobody collected the car")
  assert.equal(applyPlain(slot.situation, found).body, "The slot ended at 11:00 EEST. Call Pellavaro Auto.")
  assert.equal(gateway.calls.length, 1)
})

test("a rewrite applies only to the text it was written for", async () => {
  const gateway = proseGateway(reply([{ id: "1", headline: "Nobody collected the car", body: null }]))
  const service = createPlainWords({ gateway, cache: createMemoryPlainCache(), model: "m" })
  await service.fill([slot])
  const found = (await service.lookup([slot])).get(0)
  const changed = situation("Car will arrive after the promise", null)
  assert.equal(applyPlain(changed, found).headline, "Car will arrive after the promise")
})

test("a failed or rejected card keeps its code text and is not asked again", async () => {
  const failing = failingGateway("blocked")
  const service = createPlainWords({ gateway: failing, cache: createMemoryPlainCache(), model: "m" })
  await service.fill([slot])
  await service.fill([slot])
  assert.equal(failing.calls.length, 1)
  assert.equal((await service.lookup([slot])).size, 0)

  const wrong = proseGateway(reply([{ id: "1", headline: "Slot ended at 12:00", body: null }]))
  const strict = createPlainWords({ gateway: wrong, cache: createMemoryPlainCache(), model: "m" })
  await strict.fill([slot])
  assert.equal((await strict.lookup([slot])).size, 0)
})

test("without a gateway nothing is rewritten", async () => {
  const service = createPlainWords({ gateway: null, cache: createMemoryPlainCache() })
  await service.fill([slot])
  assert.equal((await service.lookup([slot])).size, 0)
})
