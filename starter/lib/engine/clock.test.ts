// The demo clock (ticket 04): moving it, the due items it reaches, next checks
// recorded in the snapshot, and reset. Asserted through the engine only.

import assert from "node:assert/strict"
import { test } from "node:test"
import { becameDue, type EngineState } from "./engine"
import { eachStore, testEngine } from "./testing"

const START = "2026-10-21T09:00:00.000Z"
const TEN = "2026-10-21T10:00:00.000Z"

const order = (state: EngineState, reference: string) => {
  const found = state.orders.find((row) => row.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

test("at the start nothing is due yet and the 10:00 next checks come first", async () => {
  const state = await (await testEngine()).state()
  assert.equal(state.nextDueAt, TEN)
  assert.equal(state.dueItems.filter((item) => item.due).length, 0)
  const atTen = state.dueItems.filter((item) => item.at === TEN).map((item) => item.reference).sort()
  assert.deepEqual(atTen, ["CD-420015", "CD-420458", "CD-420516"])
  for (const item of state.dueItems) assert.equal(item.kind, "next_check")
})

eachStore("next due item moves the clock to 10:00 and says which next checks came due", async (engine) => {
  const before = await engine.clock()
  const state = await engine.apply({ type: "advanceToNextDue" })
  assert.equal(state.now, TEN)
  assert.deepEqual(becameDue(state, before).map((item) => item.reference), ["CD-420015", "CD-420458", "CD-420516"])
  assert.ok(state.nextDueAt && state.nextDueAt > TEN)
})

eachStore("+15 min says nothing became due before 10:00, then the 10:00 checks at 10:00", async (engine) => {
  let from = await engine.clock()
  for (let step = 0; step < 3; step += 1) {
    const state = await engine.apply({ type: "advanceClock", minutes: 15 })
    assert.deepEqual(becameDue(state, from), [])
    from = state.now
  }
  const atTen = await engine.apply({ type: "advanceClock", minutes: 15 })
  assert.equal(atTen.now, TEN)
  assert.equal(becameDue(atTen, from).length, 3)
})

eachStore("next due item refuses to move when nothing is left to come due", async (engine) => {
  const last = (await engine.state()).dueItems.at(-1)
  assert.ok(last)
  const minutes = (new Date(last.at).getTime() - new Date(START).getTime()) / 60_000
  await engine.apply({ type: "advanceClock", minutes })
  const state = await engine.state()
  assert.equal(state.nextDueAt, null)
  await assert.rejects(engine.apply({ type: "advanceToNextDue" }), /nothing/i)
  assert.equal((await engine.state()).now, state.now)
})

eachStore("CD-420516's next check plans a site call to the stock-control contact at 10:00 and the order moves to In progress", async (engine) => {
  const before = order(await engine.state(), "CD-420516")
  assert.equal(before.group, "normal")
  assert.equal(before.rules.find((rule) => rule.id === "NEXT")?.outcome, "pass")
  const after = order(await engine.apply({ type: "advanceToNextDue" }), "CD-420516")
  assert.equal(after.group, "in_progress")
  const next = after.rules.find((rule) => rule.id === "NEXT")
  assert.equal(next?.outcome, "fail")
  assert.equal(next?.firstAction, "site_call")
  assert.ok(next?.sources.some((source) => source.collection === "conversations" && source.id === "conv-x53b0830c80a6336b"))
  const call = after.planned.find((action) => action.kind === "site_call")
  assert.ok(call?.ruleIds.includes("NEXT"))
  assert.ok(call?.callee?.handle)
})

eachStore("CD-420458's next check goes to the operator at 10:00, because the open question is with the customer", async (engine) => {
  const after = order(await engine.apply({ type: "advanceToNextDue" }), "CD-420458")
  const next = after.rules.find((rule) => rule.id === "NEXT")
  assert.equal(next?.outcome, "fail")
  assert.equal(next?.firstAction, "show_person")
  assert.match(next?.detail ?? "", /seller hold clearance/i)
  assert.equal(after.group, "needs_action")
  assert.ok(!after.planned.some((action) => action.ruleIds.includes("NEXT")), "no call is planned for a customer-side question")
})

test("an order with no next check has no NEXT rule", async () => {
  const state = await (await testEngine()).state()
  const withChecks = new Set(state.dueItems.map((item) => item.reference))
  for (const row of state.orders) {
    assert.equal(row.rules.some((rule) => rule.id === "NEXT"), withChecks.has(row.reference), row.reference)
  }
})

eachStore("reset after the 10:00 checks fired brings back the start state", async (engine) => {
  const start = await engine.state()
  await engine.apply({ type: "advanceToNextDue" })
  await engine.apply({ type: "advanceToNextDue" })
  const reset = await engine.apply({ type: "reset" })
  assert.equal(reset.now, START)
  assert.equal(reset.nextDueAt, TEN)
  assert.equal(reset.dueItems.filter((item) => item.due).length, 0)
  assert.equal(order(reset, "CD-420516").group, "normal")
  assert.deepEqual(reset.groupCounts, start.groupCounts)
  assert.deepEqual(reset.orders, start.orders)
})

eachStore("rule checks re-run on a clock move: CD-420399 goes to Needs action once its pickup slot passes", async (engine) => {
  const before = order(await engine.state(), "CD-420399")
  assert.notEqual(before.group, "needs_action")
  // The slot ends 22 Oct 12:00 CEST (10:00Z).
  const minutes = (new Date("2026-10-22T10:15:00Z").getTime() - new Date(START).getTime()) / 60_000
  const after = order(await engine.apply({ type: "advanceClock", minutes }), "CD-420399")
  assert.equal(after.rules.find((rule) => rule.id === "R11")?.outcome, "fail")
  assert.equal(after.group, "needs_action")
})
