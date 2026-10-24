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

test("at the start only the 09:00 digest is due and the 10:00 next checks come first", async () => {
  const state = await (await testEngine()).state()
  assert.equal(state.nextDueAt, TEN)
  assert.deepEqual(state.dueItems.filter((item) => item.due).map((item) => item.id), ["digest:09:00"])
  const atTen = state.dueItems.filter((item) => item.at === TEN).map((item) => item.reference).sort()
  assert.deepEqual(atTen, ["CD-420015", "CD-420458", "CD-420516"])
  for (const item of state.dueItems) assert.ok(["next_check", "digest"].includes(item.kind))
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

eachStore("CD-420458's next check becomes a proposal to the operator at 10:00, because the open question is with the customer", async (engine) => {
  const before = order(await engine.state(), "CD-420458")
  assert.ok(!before.proposals.some((proposal) => proposal.source === "rule:NEXT"), "nothing before the check is due")
  const after = order(await engine.apply({ type: "advanceToNextDue" }), "CD-420458")
  const next = after.rules.find((rule) => rule.id === "NEXT")
  assert.equal(next?.outcome, "fail")
  assert.equal(next?.firstAction, "operator_proposal")
  assert.match(next?.detail ?? "", /seller hold clearance/i)
  assert.ok(!after.planned.some((action) => action.ruleIds.includes("NEXT")), "no call is planned for a customer-side question")
  // The next step: the agent proposes the customer contact; ADR 0001 keeps it propose-only.
  const proposal = after.proposals.find((row) => row.source === "rule:NEXT")
  assert.ok(proposal, "a proposal to the operator")
  assert.equal(proposal.kind, "customer_contact")
  assert.equal(proposal.status, "proposed")
  assert.equal(proposal.waitingOn, "operator")
  assert.equal(proposal.contact.handle, null)
  assert.equal(proposal.policyRow, "customer-side")
  assert.ok(proposal.evidence.some((cited) => cited.recordId === "conv-xb088d8b061f794e5"), "it cites the thread whose check came due")
  assert.equal(after.group, "needs_action")
  assert.match(after.reason, /Waiting for your yes/)

  // The operator makes the contact and records the answer; its update's yes settles the check.
  await engine.apply({ type: "approve", proposalId: proposal.id })
  const answered = order(await engine.apply({ type: "recordAnswer", proposalId: proposal.id, answer: "The seller cleared the hold; the release follows today." }), "CD-420458")
  const update = answered.proposals.find((row) => row.kind === "change" && row.source === proposal.id)
  assert.ok(update, "the answer becomes an update for a yes")
  const settled = order(await engine.apply({ type: "approve", proposalId: update.id }), "CD-420458")
  assert.ok(!settled.rules.some((rule) => rule.id === "NEXT" && rule.outcome === "fail"), "the answered thread's check no longer fires")
  assert.ok(settled.effects.some((event) => event.supersedes.includes("conv-xb088d8b061f794e5")))
})

eachStore("CD-420326's 11:00 check is an operator question; answering it closes the check", async (engine) => {
  await engine.apply({ type: "advanceToNextDue" })
  const due = order(await engine.apply({ type: "advanceToNextDue" }), "CD-420326")
  assert.equal(due.rules.find((rule) => rule.id === "NEXT")?.firstAction, "operator_proposal")
  const question = due.proposals.find((row) => row.source === "rule:NEXT")
  assert.ok(question, "a question to the operator")
  assert.equal(question.kind, "operator_question")
  assert.equal(question.waitingOn, "operator")
  assert.match(due.reason, /Question for you/)
  assert.equal(due.group, "needs_action")

  const answered = order(await engine.apply({ type: "answerQuestion", proposalId: question.id, answer: "Expenses decides both claims today." }), "CD-420326")
  assert.equal(answered.proposals.find((row) => row.id === question.id)?.status, "answered")
  assert.ok(!answered.rules.some((rule) => rule.id === "NEXT" && rule.outcome === "fail"), "the answered thread's check no longer fires")
  assert.notEqual(answered.group, "needs_action")
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
  assert.deepEqual(reset.dueItems.filter((item) => item.due).map((item) => item.id), ["digest:09:00"])
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
