// Publishing and the travel planner (spec .scratch/publishing), read through `state`
// and `apply` like the other engine tests, plus the pure demand filter and planner.
// Expected values come from the dataset, looked up by hand: routes, countries, quotes.

import assert from "node:assert/strict"
import { test } from "node:test"
import { NO_USAGE, type ChatRequest, type ModelGateway } from "@/lib/reviewer/gateway"
import type { Bundle } from "@/lib/present/bundle"
import type { Engine, OrderState } from "./engine"
import { demandCheck, travelBudget } from "./publishing"
import { eachStore, testEngine, testGateway, testSnapshot } from "./testing"
import { planInput, planTrip, templatePlan, type CachedPlan, type PlanCache } from "./travel-planner"

async function bundle(reference: string): Promise<Bundle> {
  const found = (await testSnapshot()).bundles.find((row) => row.order.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

async function order(engine: Engine, reference: string): Promise<OrderState> {
  const found = (await engine.state()).orders.find((row) => row.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

/** A call result the agent commits (what a finished call writes), on an order. */
async function callResult(engine: Engine, reference: string, claim: string): Promise<void> {
  const { id } = await order(engine, reference)
  await engine.apply({ type: "recordEffect", effect: { type: "call_result_recorded", with: "Pickup desk (site)", claim, orderId: id, source: `call-test-${claim.length}` } })
}

// -- The demand filter ---------------------------------------------------------

test("the demand filter: cross-country, more than 12 h of driving, or a ferry between the endpoints", async () => {
  const graz = demandCheck(await bundle("CD-421053"))
  assert.equal(graz.demanding, true)
  assert.equal(graz.crossBorder, true, "Graz (AT) to Paris (FR)")
  assert.match(graz.reasons[0], /Cross-country: Graz \(AT\) to Paris \(FR\)/)

  const marseille = demandCheck(await bundle("CD-420692"))
  assert.equal(marseille.crossBorder, false, "Marseille to Lille is domestic")
  assert.equal(marseille.km, 1042)
  assert.ok(marseille.driveHours! > 12)
  assert.equal(marseille.demanding, true)

  const odense = demandCheck(await bundle("CD-420257"))
  assert.ok(odense.crossings.includes("ferry crossing on the route"), "a DRIVE_WITH_FERRY segment")

  const paris = demandCheck(await bundle("CD-420679"))
  assert.equal(paris.demanding, false, "Marseille to Paris, 826 km: about 11 h, domestic, no ferry")
  assert.deepEqual(paris.reasons, [])

  assert.equal(demandCheck(await bundle("CD-420015")).demanding, false, "Espoo to Helsinki")
})

test("each order has a fixed travel budget from 30 to 200 EUR", async () => {
  const budgets = (await testSnapshot()).bundles.map((row) => travelBudget(row.order.reference))
  assert.ok(budgets.every((value) => value >= 30 && value <= 200 && value % 5 === 0))
  assert.ok(new Set(budgets).size > 20, "budgets differ between orders")
  assert.equal(travelBudget("CD-420257"), travelBudget("CD-420257"))
})

// -- The travel planner ----------------------------------------------------------

test("the template plan books a night stop on a long drive and the cheapest open ferry quote", async () => {
  const raw = await bundle("CD-420257")
  const input = planInput(raw, demandCheck(raw), 120)
  const plan = templatePlan(input, "Template plan: no model key is set.")
  assert.equal(plan.hotel.needed, true, "1448 km is far more than a day's drive")
  assert.ok(plan.legs.some((leg) => leg.kind === "hotel"))
  const ferry = plan.legs.find((leg) => leg.kind === "ferry")
  assert.equal(ferry?.costEur, 256, "ord-00257's open ferry quotes are EUR 256, 369 and 485")
  assert.equal(plan.totalEur, plan.legs.reduce((sum, leg) => sum + leg.costEur, 0))
  assert.equal(plan.withinBudget, false)
  assert.equal(plan.source, "template")
})

function planGateway(content: string): ModelGateway & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = []
  return {
    calls,
    async chat(request) {
      calls.push(request)
      return { message: { role: "assistant", content }, finishReason: "stop", usage: { ...NO_USAGE, cost: 0.004 }, model: "test-planner" }
    },
  }
}

function memoryPlanCache(): PlanCache {
  const plans = new Map<string, CachedPlan>()
  return { async get(key) { return plans.get(key) ?? null }, async put(key, plan) { plans.set(key, plan) } }
}

const MODEL_PLAN = {
  summary: "Train to Graz the evening before, two driving days with a night in Munich, train home from Paris.",
  hotel: { needed: true, why: "About 19 h of driving." },
  legs: [
    { kind: "train", from: "Driver's home area", to: "Graz", when: "evening before pickup", costEur: 60, note: "rough" },
    { kind: "drive", from: "Graz", to: "Munich", when: "pickup day", costEur: 0, note: "" },
    { kind: "hotel", from: "Munich", to: "Munich", when: "night after pickup", costEur: 85, note: "rough" },
    { kind: "drive", from: "Munich", to: "Paris", when: "second day", costEur: 0, note: "" },
    { kind: "train", from: "Paris", to: "Driver's home area", when: "after delivery", costEur: 70, note: "rough" },
  ],
  caveats: ["Over budget: the cheapest workable plan."],
}

test("the planner's plan is validated, its total computed, and cached", async () => {
  const raw = await bundle("CD-421053")
  const input = planInput(raw, demandCheck(raw), 150)
  const gateway = planGateway(JSON.stringify({ ...MODEL_PLAN, totalEur: 1 }))
  const cache = memoryPlanCache()
  const plan = await planTrip(input, { gateway, cache, model: "test-planner" })
  assert.equal(plan.source, "model")
  assert.equal(plan.totalEur, 215, "summed from the legs, never the model's own total")
  assert.equal(plan.withinBudget, false)
  assert.equal(plan.cost, 0.004)
  assert.equal(gateway.calls[0].job, "travel-plan")
  assert.match(String(gateway.calls[0].messages[1].content), /"budgetEur":150/)

  const again = await planTrip(input, { gateway, cache, model: "test-planner" })
  assert.equal(gateway.calls.length, 1, "the second plan is a cache hit")
  assert.equal(again.cached, true)
  assert.equal(again.cost, 0)
})

test("a rejected plan falls back to the template, with the reason", async () => {
  const raw = await bundle("CD-421053")
  const input = planInput(raw, demandCheck(raw), 150)
  const noHotel = await planTrip(input, { gateway: planGateway(JSON.stringify({ ...MODEL_PLAN, legs: MODEL_PLAN.legs.filter((leg) => leg.kind !== "hotel") })) })
  assert.equal(noHotel.source, "template")
  assert.match(noHotel.note ?? "", /no hotel leg/)
  const prose = await planTrip(input, { gateway: planGateway("Take the train.") })
  assert.match(prose.note ?? "", /not JSON/)
})

test("a drive of 12 h or less gets no hotel, from the model or the template", async () => {
  const raw = await bundle("CD-421053")
  const input = { ...planInput(raw, demandCheck(raw), 150), driveHours: 11 }
  const plan = await planTrip(input, { gateway: planGateway(JSON.stringify(MODEL_PLAN)) })
  assert.equal(plan.source, "template", "the model's hotel on an 11 h drive is rejected")
  assert.match(plan.note ?? "", /hotel is planned for a drive of 12 h or less/)
  assert.equal(plan.hotel.needed, false)
  assert.ok(!plan.legs.some((leg) => leg.kind === "hotel"))
  const exactly = templatePlan({ ...input, driveHours: 12 }, "")
  assert.equal(exactly.hotel.needed, false, "12 h is not more than 12 h")
  const longer = templatePlan({ ...input, driveHours: 12.5 }, "")
  assert.equal(longer.hotel.needed, true)
})

// -- Publishing through the engine -----------------------------------------------

eachStore("the agent publishes a Normal order not on the market only once the reviewer read it", async (engine) => {
  const before = await order(engine, "CD-420009")
  assert.equal(before.group, "normal")
  assert.equal(before.publication.stage, "unposted")
  assert.equal(before.publication.lane, "intake")

  await engine.apply({ type: "review", orderIds: [before.id] })
  await engine.apply({ type: "runPublishing" })

  const after = await order(engine, "CD-420009")
  assert.equal(after.publication.stage, "market")
  assert.equal(after.publication.lane, "market", "shown under Finding a driver")
  assert.deepEqual(after.publication.published && after.publication.published.by, "agent")
  assert.equal(after.publication.check?.demanding, false, "Tampere to Helsinki")
  assert.equal(after.publication.live, true, "not demanding: live for drivers at once")

  const unread = await order(engine, "CD-420010")
  assert.equal(unread.group, "normal")
  assert.equal(unread.publication.stage, "unposted", "Normal on the rules alone is not published")
}, { gateway: () => testGateway() })

eachStore("orders on the market go through the demand filter; demanding ones reach drivers with a travel plan", async (engine) => {
  await engine.apply({ type: "runPublishing" })
  const ferry = await order(engine, "CD-420257")
  assert.equal(ferry.publication.stage, "market", "Finding a driver in the data")
  assert.equal(ferry.publication.check?.demanding, true)
  assert.equal(ferry.publication.plan?.source, "template", "no model key")
  assert.equal(ferry.publication.live, true)

  const short = await order(engine, "CD-420404")
  assert.equal(short.publication.check?.demanding, false)
  assert.equal(short.publication.plan, null)
  assert.equal(short.publication.live, true)

  const moving = (await engine.state()).orders.find((row) => row.publication.stage === "posted")
  assert.ok(moving && moving.publication.check === null, "orders past the market are never filtered")

  await engine.apply({ type: "runPublishing" })
  const again = await order(engine, "CD-420257")
  assert.deepEqual(again.publication.plan, ferry.publication.plan, "one plan per order")
})

eachStore("a Solved order waits in Confirm before publishing until the operator approves the rewrite", async (engine) => {
  await callResult(engine, "CD-420010", "The car is ready and the keys are at the desk")
  const solved = await order(engine, "CD-420010")
  assert.equal(solved.group, "solved")
  assert.match(solved.reason, /waiting for your yes/)
  assert.equal(solved.publication.stage, "confirm")
  assert.equal(solved.publication.lane, "confirm")
  assert.equal(solved.publication.pending.length, 1)
  assert.equal(solved.publication.pending[0].after, "The car is ready and the keys are at the desk")

  await engine.apply({ type: "runPublishing" })
  assert.equal((await order(engine, "CD-420010")).publication.stage, "confirm", "the agent never publishes a Solved order")

  await engine.apply({ type: "confirmChanges", orderId: solved.id })
  const published = await order(engine, "CD-420010")
  assert.equal(published.group, "normal")
  assert.equal(published.publication.stage, "market")
  assert.equal(published.publication.published?.by, "operator")
  assert.deepEqual(published.publication.pending, [])

  // Once published, a later call result is committed as it is: the order is never Solved again.
  await callResult(engine, "CD-420010", "Pickup moved to the back gate")
  const later = await order(engine, "CD-420010")
  assert.equal(later.group, "normal")
  assert.deepEqual(later.publication.pending, [])
  await assert.rejects(engine.apply({ type: "confirmChanges", orderId: later.id }), /no call results waiting/)
})

test("call results on orders on the market or on the road need no approval; only changes from calls make them Solved", async () => {
  const engine = await testEngine()
  await engine.apply({ type: "runCalls" })
  for (let step = 0; step < 6; step += 1) {
    await engine.apply({ type: "advanceClock", minutes: 30 })
    await engine.apply({ type: "runCalls" })
  }
  const { orders } = await engine.state()
  const solved = orders.filter((row) => row.group === "solved")
  assert.ok(solved.length > 0, "CD-420516 is")
  const past = solved.filter((row) => !row.publication.inFlow || row.publication.published)
  assert.ok(past.length > 0, "an order past the market with a change from a call is Solved too")
  for (const row of past) {
    assert.deepEqual(row.publication.pending, [], `${row.reference}: its call results are committed as they are`)
    assert.ok(row.publication.changes.length > 0, `${row.reference}: a change from a call waits`)
  }
  const onRoad = await order(engine, "CD-420806")
  assert.ok(onRoad.effects.some((event) => event.type === "call_result_recorded" && event.by === "agent"), "the driver call's result is committed")
  assert.equal(onRoad.group, "normal")

  // The yes on an order past the market approves its changes and keeps its stage: it is not published again.
  const [first] = past
  await engine.apply({ type: "confirmChanges", orderId: first.id })
  const after = await order(engine, first.reference)
  assert.notEqual(after.group, "solved")
  assert.equal(after.publication.stage, first.publication.stage)
  assert.deepEqual(after.publication.published, first.publication.published)
  for (const change of first.publication.changes) {
    assert.equal(after.proposals.find((proposal) => proposal.id === change.proposalId)?.status, "approved")
  }
})

eachStore("the operator publishes Normal or Solved orders not on the market yet, and nothing else", async (engine) => {
  const onMarket = await order(engine, "CD-420404")
  await assert.rejects(engine.apply({ type: "publish", orderId: onMarket.id }), /not waiting to be posted/)
  const needsAction = await order(engine, "CD-420458")
  assert.equal(needsAction.group, "needs_action")
  await assert.rejects(engine.apply({ type: "publish", orderId: needsAction.id }), /only a Normal or Solved order/)

  const normal = await order(engine, "CD-420010")
  await engine.apply({ type: "publish", orderId: normal.id })
  assert.equal((await order(engine, "CD-420010")).publication.published?.by, "operator")
  await assert.rejects(engine.apply({ type: "publish", orderId: normal.id }), /already published/)
})

test("a background call that settles an order's open point makes it Solved, with the call's transcript", async () => {
  const engine = await testEngine()
  await engine.apply({ type: "runCalls" })
  for (let step = 0; step < 6; step += 1) {
    await engine.apply({ type: "advanceClock", minutes: 30 })
    await engine.apply({ type: "runCalls" })
  }
  const solved = await order(engine, "CD-420516")
  assert.equal(solved.group, "solved")
  assert.equal(solved.publication.stage, "confirm")
  const [change] = solved.publication.pending
  assert.match(change.after, /ready/i)
  assert.ok(change.call && change.call.transcript.length > 0)
  assert.equal(change.call.line, "site")
})

test("a handover the operator closed leaves nothing to confirm: the operator's result replaced the agent's", async () => {
  const engine = await testEngine()
  await engine.apply({ type: "runCalls" })
  const handedOver = await order(engine, "CD-420692")
  const call = handedOver.calls.find((row) => row.handover)
  assert.ok(call, "the site said they are not the pickup contact")
  await engine.apply({ type: "recordHandoverResult", callId: call.id, result: "Spoke to the dealer: Ines Varrow is the pickup contact" })
  const after = await order(engine, "CD-420692")
  assert.deepEqual(after.publication.pending, [])
  assert.notEqual(after.group, "solved")
})
