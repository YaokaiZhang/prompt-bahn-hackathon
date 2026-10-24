// Proposals, the approval policy and the operator's decisions (ticket 07), read
// through `state` and `apply` only. The reviewer is the scripted gateway: the
// permanent scenarios for CD-420089, 399, 437, 458 and 516, "nothing to ask" for
// every other order. Expected values come from the scenario fixtures and the
// policy table in the spec, looked up by hand.

import assert from "node:assert/strict"
import { test } from "node:test"
import { CONTACT_TYPES, POLICY_ROW_IDS, policyFor, renderPolicy } from "@/lib/reviewer/policy"
import type { Engine, OrderState } from "./engine"

import { eachStore, testEngine, testGateway } from "./testing"

function find(orders: OrderState[], reference: string): OrderState {
  const found = orders.find((row) => row.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

async function reviewed(): Promise<Engine> {
  const engine = await testEngine({ gateway: await testGateway() })
  await engine.apply({ type: "review" })
  return engine
}

test("policy lookup: every contact type has a row for a question and for an order change", () => {
  assert.equal(policyFor("third_party_site", "question").id, "site-routine")
  assert.equal(policyFor("third_party_site", "question").decision, "acts alone")
  assert.equal(policyFor("driver", "question").id, "driver-routine")
  assert.equal(policyFor("operator", "question").id, "operator-question")
  for (const type of ["paying_customer", "customer_given_contact", "customer_owned_site"] as const) {
    assert.equal(policyFor(type, "question").id, "customer-side", type)
    assert.equal(policyFor(type, "question").decision, "propose only", type)
  }
  for (const type of CONTACT_TYPES) {
    assert.equal(policyFor(type, "change").id, "order-change", type)
    assert.equal(policyFor(type, "change").decision, "needs a yes", type)
  }
})

test("policy lookup: a pickup-readiness call to a customer-side pickup place or contact acts alone; the paying customer is never called", () => {
  for (const type of ["customer_owned_site", "customer_given_contact"] as const) {
    assert.equal(policyFor(type, "pickup_readiness").id, "pickup-readiness", type)
    assert.equal(policyFor(type, "pickup_readiness").decision, "acts alone", type)
  }
  assert.equal(policyFor("third_party_site", "pickup_readiness").id, "site-routine")
  for (const type of ["paying_customer", "driver", "operator"] as const) {
    assert.throws(() => policyFor(type, "pickup_readiness"), /No policy row/, type)
  }
  // The reviewer's prompt and its policy_row enum keep the five rows it was tuned on.
  assert.doesNotMatch(renderPolicy(), /pickup-readiness/)
  assert.ok(!POLICY_ROW_IDS.includes("pickup-readiness"))
})

test("a customer-side finding becomes a propose-only proposal with its evidence, contact type, who pays and policy row", async () => {
  const order = find((await (await reviewed()).state()).orders, "CD-420437")
  assert.equal(order.proposals.length, 1)
  const [proposal] = order.proposals
  assert.equal(proposal.kind, "customer_contact")
  assert.equal(proposal.status, "proposed")
  assert.equal(proposal.policyRow, "customer-side")
  assert.equal(proposal.decision, "propose only")
  assert.equal(proposal.contact.type, "paying_customer")
  assert.equal(proposal.contact.handle, null, "the agent never has a channel to the customer")
  assert.match(proposal.whoPays, /cus-025 Calverona Auto pays Bahn/)
  assert.match(proposal.script, /is Celia Hollowmere authorised to inspect and sign/)
  assert.ok(proposal.evidence.some((cited) => cited.role === "conflict"))
  assert.equal(proposal.findingId, order.review.findings[0].id)
  assert.match(proposal.onApprove ?? "", /hands you the contact/i)
  assert.deepEqual(proposal.history.map((event) => event.kind), ["proposed"])
  assert.equal(order.group, "needs_action")
  assert.match(order.reason, /Waiting for your yes/)
})

test("a routine site finding is a call the agent makes on its own: approved by the policy, the order In progress", async () => {
  const order = find((await (await reviewed()).state()).orders, "CD-420516")
  const [proposal] = order.proposals
  assert.equal(proposal.kind, "call")
  assert.equal(proposal.policyRow, "site-routine")
  assert.equal(proposal.decision, "acts alone")
  assert.equal(proposal.status, "approved")
  assert.equal(proposal.waitingOn, "agent")
  assert.equal(proposal.onApprove, null)
  assert.equal(proposal.contact.type, "third_party_site")
  assert.equal(proposal.contact.handle, "site-001@example.test")
  assert.deepEqual(proposal.history.map((event) => [event.by, event.kind]), [["agent", "proposed"], ["policy", "approved"]])
  assert.equal(order.group, "in_progress")
  assert.match(order.reason, /Agent will call Adrian Alderbrook.*Pickup key holder unknown/)
})

test("a driver finding is a call to the driver by driver ID; an operator finding is a question that waits in Needs action", async () => {
  const { orders } = await (await reviewed()).state()
  const driver = find(orders, "CD-420399").proposals[0]
  assert.equal(driver.kind, "call")
  assert.equal(driver.policyRow, "driver-routine")
  assert.equal(driver.contact.handle, "drv-331")
  const question = find(orders, "CD-420089")
  assert.equal(question.proposals[0].kind, "operator_question")
  assert.equal(question.proposals[0].policyRow, "operator-question")
  assert.equal(question.proposals[0].waitingOn, "operator")
  assert.equal(question.group, "needs_action")
  assert.match(question.reason, /Question for you: Positioning train from Lahti/)
})

const withModel = { gateway: testGateway }

async function proposalOn(engine: Engine, reference: string) {
  const order = find((await engine.state()).orders, reference)
  assert.ok(order.proposals[0], `${reference} has a proposal`)
  return order.proposals[0]
}

eachStore("approving a customer-side proposal hands the contact to the operator and is recorded in its history", async (engine) => {
  await engine.apply({ type: "review" })
  const { id } = await proposalOn(engine, "CD-420437")
  await engine.apply({ type: "advanceClock", minutes: 15 })
  const order = find((await engine.apply({ type: "approve", proposalId: id })).orders, "CD-420437")
  const [proposal] = order.proposals
  assert.equal(proposal.status, "approved")
  assert.equal(proposal.waitingOn, "operator")
  assert.equal(proposal.onApprove, null)
  assert.deepEqual(proposal.history.map((event) => [event.by, event.kind]), [["agent", "proposed"], ["operator", "approved"]])
  assert.equal(proposal.history[1].at, "2026-10-21T09:15:00.000Z")
  assert.match(proposal.history[1].text, /handed to the operator/)
  // The contact is the operator's to make now; the order still needs a person.
  assert.equal(order.group, "needs_action")
  assert.match(order.reason, /Customer contact is with you/)
  await assert.rejects(engine.apply({ type: "approve", proposalId: id }), /only a proposal waiting for a yes can be approved/)
}, withModel)

eachStore("dismissing the only open proposal takes the order out of Needs action, keeping the history", async (engine) => {
  await engine.apply({ type: "review" })
  const { id } = await proposalOn(engine, "CD-420437")
  const order = find((await engine.apply({ type: "dismiss", proposalId: id, note: "Already sorted by phone" })).orders, "CD-420437")
  assert.equal(order.proposals[0].status, "dismissed")
  assert.equal(order.proposals[0].waitingOn, null)
  assert.match(order.proposals[0].history.at(-1)!.text, /Already sorted by phone/)
  assert.notEqual(order.group, "needs_action")
  assert.match(order.reason, /its proposal is decided/)
  await assert.rejects(engine.apply({ type: "dismiss", proposalId: id }), /cannot be dismissed/)
  await assert.rejects(engine.apply({ type: "approve", proposalId: id }), /dismissed/)
}, withModel)

eachStore("editing the script changes what approving sends and is recorded", async (engine) => {
  await engine.apply({ type: "review" })
  const before = await proposalOn(engine, "CD-420437")
  const script = "Who at Calverona Auto may sign for the Bentley in Munich today, and until when?"
  const order = find((await engine.apply({ type: "editScript", proposalId: before.id, script })).orders, "CD-420437")
  assert.equal(order.proposals[0].script, script)
  assert.equal(order.proposals[0].history.at(-1)!.kind, "edited")
  assert.match(order.proposals[0].history.at(-1)!.text, /is Celia Hollowmere authorised/)
  await assert.rejects(engine.apply({ type: "editScript", proposalId: before.id, script: "  " }), /cannot be empty/)
}, withModel)

eachStore("an instruction is saved on the proposal and appears in the next review run's case file", async (engine, gateway) => {
  await engine.apply({ type: "review" })
  const { id } = await proposalOn(engine, "CD-420516")
  const calls = gateway.calls.length
  const text = "Ask stock control directly, not the site desk."
  const order = find((await engine.apply({ type: "instruct", proposalId: id, text })).orders, "CD-420516")
  const rerun = gateway.calls.slice(calls)
  assert.ok(rerun.length > 0, "the order was reviewed again")
  assert.ok(rerun.every((request) => request.subject === "CD-420516"))
  const caseFile = rerun[0].messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n")
  assert.match(caseFile, /operator_instruction/)
  assert.match(caseFile, /Ask stock control directly, not the site desk/)
  assert.equal(order.review.status, "reviewed")
  const proposal = order.proposals.find((row) => row.id === id)!
  assert.deepEqual(proposal.instructions.map((row) => row.text), [text])
  assert.equal(proposal.history.at(-1)!.kind, "instructed")
}, withModel)

eachStore("batch approve shows what approving does per row, then writes changes and hands customer contacts to the operator", async (engine) => {
  await engine.apply({ type: "review" })
  const customer = await proposalOn(engine, "CD-420437")
  await engine.apply({
    type: "proposeChange", orderId: "ord-00516", title: "Collect the keys at the stock control desk",
    change: "Pickup access instruction: collect the keys at the stock control desk.", why: "The site said so on the call.", source: "test",
    contact: { name: "Adrian Alderbrook", type: "third_party_site", role: "site" },
  })
  const state = await engine.state()
  const waiting = state.orders.flatMap((row) => row.proposals).filter((proposal) => proposal.status === "proposed")
  const change = waiting.find((proposal) => proposal.kind === "change")!
  assert.equal(change.policyRow, "order-change")
  assert.equal(change.decision, "needs a yes")
  assert.match(change.onApprove ?? "", /Writes the change to the order: Pickup access instruction/)
  assert.match(waiting.find((proposal) => proposal.id === customer.id)!.onApprove ?? "", /Hands you the contact/)
  // The change waits for a yes, so CD-420516 now needs action.
  assert.equal(find(state.orders, "CD-420516").group, "needs_action")

  const after = await engine.apply({ type: "approveBatch", proposalIds: [customer.id, change.id] })
  const approvedChange = find(after.orders, "CD-420516").proposals.find((proposal) => proposal.id === change.id)!
  assert.equal(approvedChange.status, "approved")
  assert.equal(approvedChange.waitingOn, null)
  assert.equal(find(after.orders, "CD-420516").group, "in_progress", "back to the agent's routine call")
  assert.equal(find(after.orders, "CD-420437").proposals[0].waitingOn, "operator")
}, withModel)

eachStore("a batch with one proposal that cannot be approved approves none of them", async (engine) => {
  await engine.apply({ type: "review" })
  const customer = await proposalOn(engine, "CD-420437")
  const routine = await proposalOn(engine, "CD-420516")
  await assert.rejects(engine.apply({ type: "approveBatch", proposalIds: [customer.id, routine.id] }), /only a proposal waiting for a yes/)
  assert.equal((await proposalOn(engine, "CD-420437")).status, "proposed")
}, withModel)

eachStore("reset clears every decision", async (engine) => {
  await engine.apply({ type: "review" })
  const { id } = await proposalOn(engine, "CD-420437")
  await engine.apply({ type: "dismiss", proposalId: id })
  await engine.apply({ type: "reset" })
  const proposal = await proposalOn(engine, "CD-420437")
  assert.equal(proposal.status, "proposed")
  assert.deepEqual(proposal.history.map((event) => event.kind), ["proposed"])
}, withModel)

test("an order no reviewer has read has no proposals", async () => {
  const { orders } = await (await testEngine()).state()
  assert.ok(orders.every((row) => row.proposals.length === 0))
})
