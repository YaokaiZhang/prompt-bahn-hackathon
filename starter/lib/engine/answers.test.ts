// Customer-side proposals and operator questions (ticket 08), through `state` and
// `apply` only. The reviewer is the scripted gateway (permanent scenarios for
// CD-420089, 399, 437, 458 and 516; "nothing to ask" elsewhere). Expected values
// come from the scenario fixtures, the dataset and ADR 0001, looked up by hand.

import assert from "node:assert/strict"
import { test } from "node:test"
import type { Engine, OrderState } from "./engine"
import { eachStore, testEngine, testGateway } from "./testing"

function find(orders: OrderState[], reference: string): OrderState {
  const found = orders.find((row) => row.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

async function proposalOn(engine: Engine, reference: string) {
  const order = find((await engine.state()).orders, reference)
  assert.ok(order.proposals[0], `${reference} has a proposal`)
  return order.proposals[0]
}

const withModel = { gateway: testGateway }

eachStore("CD-420437: proposed -> approved (handed to the operator) -> answered, then the agent proposes the order update", async (engine) => {
  await engine.apply({ type: "review" })
  const { id } = await proposalOn(engine, "CD-420437")
  await engine.apply({ type: "approve", proposalId: id })
  await engine.apply({ type: "advanceClock", minutes: 15 })
  const answer = "Celia Hollowmere may sign; she is there until 18:00."
  const order = find((await engine.apply({ type: "recordAnswer", proposalId: id, answer })).orders, "CD-420437")
  const proposal = order.proposals.find((row) => row.id === id)!
  assert.equal(proposal.status, "answered")
  assert.equal(proposal.waitingOn, null)
  assert.equal(proposal.answer, answer)
  assert.deepEqual(proposal.history.map((event) => [event.by, event.kind]), [["agent", "proposed"], ["operator", "approved"], ["operator", "answered"]])
  assert.equal(proposal.history[2].at, "2026-10-21T09:15:00.000Z")
  assert.match(proposal.history[2].text, /Celia Hollowmere may sign/)

  // The update the answer calls for waits for a yes (order-change), attributed to the customer side.
  const update = order.proposals.find((row) => row.kind === "change")
  assert.ok(update, "a change proposal follows the answer")
  assert.equal(update.status, "proposed")
  assert.equal(update.policyRow, "order-change")
  assert.equal(update.contact.type, "paying_customer")
  assert.match(update.change ?? "", /Celia Hollowmere may sign/)
  assert.equal(update.source, id)
  assert.equal(order.group, "needs_action")
  assert.match(order.reason, /Waiting for your yes/)
}, withModel)

function caseFileOf(requests: { messages: { content?: unknown }[] }[]): string {
  return requests[0].messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n")
}

eachStore("a customer's answer reaches the order's next review run", async (engine, gateway) => {
  await engine.apply({ type: "review" })
  const { id } = await proposalOn(engine, "CD-420437")
  await engine.apply({ type: "approve", proposalId: id })
  const calls = gateway.calls.length
  const order = find((await engine.apply({ type: "recordAnswer", proposalId: id, answer: "Only Marten Calver may sign, until 17:00." })).orders, "CD-420437")
  const rerun = gateway.calls.slice(calls)
  assert.ok(rerun.length > 0, "the order was reviewed again")
  assert.ok(rerun.every((request) => request.subject === "CD-420437"))
  const caseFile = caseFileOf(rerun)
  assert.match(caseFile, /recorded_answer/)
  assert.match(caseFile, /Only Marten Calver may sign, until 17:00/)
  assert.match(caseFile, /is Celia Hollowmere authorised to inspect and sign/, "with the question that was asked")
  assert.equal(order.review.status, "reviewed")
  // The re-review raises the same finding again; its proposal stays answered.
  assert.equal(order.proposals.find((row) => row.id === id)!.status, "answered")
}, withModel)

eachStore("an answer is recorded only on an approved customer-side proposal, and never empty", async (engine) => {
  await engine.apply({ type: "review" })
  const customer = await proposalOn(engine, "CD-420437")
  await assert.rejects(engine.apply({ type: "recordAnswer", proposalId: customer.id, answer: "Yes." }), /approve it and make the contact before recording the answer/)
  const call = await proposalOn(engine, "CD-420516")
  await assert.rejects(engine.apply({ type: "recordAnswer", proposalId: call.id, answer: "Yes." }), /not a customer-side contact/)
  await engine.apply({ type: "approve", proposalId: customer.id })
  await assert.rejects(engine.apply({ type: "recordAnswer", proposalId: customer.id, answer: "   " }), /cannot be empty/)
  await engine.apply({ type: "recordAnswer", proposalId: customer.id, answer: "Yes." })
  await assert.rejects(engine.apply({ type: "recordAnswer", proposalId: customer.id, answer: "Again." }), /is answered/)
  await assert.rejects(engine.apply({ type: "dismiss", proposalId: customer.id }), /cannot be dismissed/)
}, withModel)

eachStore("CD-420089: the operator question about the ops-shift note waits in Needs action until answered, and the answer reaches the next review", async (engine, gateway) => {
  await engine.apply({ type: "review" })
  const before = find((await engine.state()).orders, "CD-420089")
  const question = before.proposals[0]
  assert.equal(question.kind, "operator_question")
  assert.match(question.script, /Your note on CD-420089 relies on the Lahti to Espoo train/)
  assert.match(question.script, /CD-420719 duty ends with a handover in Helsinki/)
  assert.ok(question.evidence.some((cited) => cited.recordId === "note-x30f784d8cd92ba78"))
  assert.ok(question.evidence.some((cited) => cited.recordId === "step-x88ed7ca82db890c5"), "cites the CD-420719 duty")
  assert.equal(before.group, "needs_action")
  // A clock move does not answer it.
  assert.equal(find((await engine.apply({ type: "advanceClock", minutes: 60 })).orders, "CD-420089").group, "needs_action")

  const calls = gateway.calls.length
  const answer = "No: the driver starts from Helsinki. Rebook the train from Helsinki."
  const order = find((await engine.apply({ type: "answerQuestion", proposalId: question.id, answer })).orders, "CD-420089")
  const answered = order.proposals.find((row) => row.id === question.id)!
  assert.equal(answered.status, "answered")
  assert.equal(answered.waitingOn, null)
  assert.equal(answered.answer, answer)
  assert.deepEqual(answered.history.map((event) => [event.by, event.kind]), [["agent", "proposed"], ["policy", "approved"], ["operator", "answered"]])
  assert.doesNotMatch(order.reason, /Question for you/)
  const caseFile = caseFileOf(gateway.calls.slice(calls))
  assert.match(caseFile, /recorded_answer/)
  assert.match(caseFile, /Rebook the train from Helsinki/)
  await assert.rejects(engine.apply({ type: "answerQuestion", proposalId: question.id, answer: "Again." }), /cannot be answered/)
}, withModel)

eachStore("only a question to the operator takes the operator's answer", async (engine) => {
  await engine.apply({ type: "review" })
  const customer = await proposalOn(engine, "CD-420437")
  await assert.rejects(engine.apply({ type: "answerQuestion", proposalId: customer.id, answer: "Yes." }), /not a question to the operator/)
}, withModel)

// A site finding whose contact record does not name the contact: the agent falls back to
// the order's pickup endpoint. The records, not the reviewer's label, decide its type.
function siteFinding(conflict: { record_id: string; field: string; quote: string }[], contact: { record: string; quote: string; name: string }) {
  return {
    title: "Pickup handover not confirmed", conflict,
    ask: { role: "site", contact_type: "third_party_site", contact_record_id: contact.record, contact_quote: contact.quote, name: contact.name },
    who_pays: "The site does not pay Bahn.", policy_row: "site-routine",
    question: "Who will hand over the car at pickup, and when?", why: "Nobody has confirmed the pickup handover.",
  }
}

const customerSideFindings = {
  // Pickup at site-092 Velantora Oulu, owned by cus-001, the order's customer.
  "CD-420719": [siteFinding(
    [{ record_id: "win-x3d20c26a9dc3ad81", field: "source", quote: "OPS" }, { record_id: "step-x13f6faa21ee54b85", field: "note", quote: "physical collection unverified" }],
    { record: "step-x13f6faa21ee54b85", quote: "branch desk", name: "Velantora Oulu branch desk" },
  )],
  // Pickup contact Julian Alderwick, stated_by CUSTOMER_ORDER_INPUT.
  "CD-420020": [siteFinding(
    [{ record_id: "proof-xfcd76b434eb14c61", field: "status", quote: "SUBMITTED" }, { record_id: "win-x015d77fca5c363ea", field: "source", quote: "OPS" }],
    { record: "proof-xfcd76b434eb14c61", quote: "PICKUP_PHOTOS", name: "the pickup key holder" },
  )],
}

eachStore("a site contact the records show is on the customer side is never called: it becomes a propose-only customer contact", async (engine) => {
  await engine.apply({ type: "review", orderIds: ["ord-00719", "ord-00020"] })
  const { orders } = await engine.state()
  const owned = find(orders, "CD-420719").proposals[0]
  assert.ok(owned, "CD-420719 has a proposal")
  assert.equal(owned.kind, "customer_contact")
  assert.equal(owned.contact.type, "customer_owned_site")
  assert.equal(owned.policyRow, "customer-side")
  assert.equal(owned.decision, "propose only")
  assert.equal(owned.status, "proposed")
  assert.equal(owned.contact.handle, null)
  const given = find(orders, "CD-420020").proposals[0]
  assert.ok(given, "CD-420020 has a proposal")
  assert.equal(given.kind, "customer_contact")
  assert.equal(given.contact.type, "customer_given_contact")
  assert.equal(given.contact.handle, null)
  assert.equal(find(orders, "CD-420719").group, "needs_action")
}, { gateway: () => testGateway(customerSideFindings) })

test("the rules plan a pickup-readiness call to a customer-side pickup contact (ADR 0001 amendment)", async () => {
  const engine = await testEngine()
  const { orders } = await engine.state()
  // CD-420719 picks up at site-092 Velantora Oulu, owned by its customer cus-001, within 48 h.
  // CD-420449, CD-421011 and CD-421051 pick up within 48 h from a person the customer gave
  // (stated_by CUSTOMER_ORDER_INPUT, a handoff-… handle).
  for (const reference of ["CD-420719", "CD-420449", "CD-421011", "CD-421051"]) {
    const call = find(orders, reference).planned.find((action) => action.kind === "site_call")
    assert.ok(call?.callee?.handle, `${reference} plans a pickup-readiness call`)
    assert.ok(call.ruleIds.every((id) => ["R1", "R4", "R5", "R6", "NEXT"].includes(id)), `${reference}: only pickup-readiness topics`)
    assert.equal(find(orders, reference).blockedCalls.length, 0, reference)
  }
  // CD-420015's customer typed in site-005's own desk email: a third-party site, still called (J2).
  assert.equal(find(orders, "CD-420015").planned.find((action) => action.kind === "site_call")?.callee?.handle, "site-005@example.test")
})

eachStore("reset clears answers", async (engine) => {
  await engine.apply({ type: "review" })
  const question = await proposalOn(engine, "CD-420089")
  await engine.apply({ type: "answerQuestion", proposalId: question.id, answer: "Still right." })
  await engine.apply({ type: "reset" })
  const after = await proposalOn(engine, "CD-420089")
  assert.equal(after.status, "approved")
  assert.equal(after.answer, null)
}, withModel)

eachStore("after a reset the order reads the review of its records without the answer again", async (engine) => {
  await engine.apply({ type: "review" })
  const before = find((await engine.state()).orders, "CD-420089").review.recordsRead
  const question = await proposalOn(engine, "CD-420089")
  const answered = find((await engine.apply({ type: "answerQuestion", proposalId: question.id, answer: "Still right." })).orders, "CD-420089")
  assert.equal(answered.review.recordsRead, before + 1, "the recorded answer is one more record")
  const reset = find((await engine.apply({ type: "reset" })).orders, "CD-420089")
  assert.equal(reset.review.recordsRead, before)
}, withModel)
