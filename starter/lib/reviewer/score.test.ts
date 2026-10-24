import assert from "node:assert/strict"
import { before, test } from "node:test"
import { loadFixtures } from "./fixtures"
import { createReviewer, type ReviewResult, type Reviewed } from "./reviewer"
import { createScriptedGateway } from "./scripted"
import { EXPECTED_CASES, scoreCase, scoreRun } from "./score"
import { testReviewSource } from "./testing"
import type { Finding } from "./validate"

before(() => {
  globalThis.fetch = (() => { throw new Error("network call in a reviewer test") }) as typeof fetch
})

const NOW = "2026-10-21T09:00:00.000Z"

function expected(reference: string) {
  const found = EXPECTED_CASES.find((item) => item.reference === reference)
  assert.ok(found)
  return found
}

function result(reference: string, findings: Finding[]): Reviewed {
  return {
    status: "reviewed", orderId: "ord", reference, hash: "h", summary: "", findings, dropped: [], recordsRead: 30,
    toolCalls: 0, refusedToolCalls: 0, turns: 1, cost: 0.01, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 0.01 },
    model: "m", reviewedAt: NOW, cached: false,
  }
}

const siteFinding: Finding = {
  title: "Key holder unknown",
  conflict: [
    { recordId: "note-x7b4b75e5977108cd", field: "body", quote: "side gate" },
    { recordId: "msg-x5d8006558b9e7cc6", field: "body", quote: "Reception does not have the keys" },
  ],
  ask: { role: "site", contactType: "third_party_site", contactRecordId: "ep-xf77895617a67a311", contactQuote: "site-001@example.test", name: "Site desk" },
  whoPays: "cus-005", policyRow: "site-routine", question: "Who holds the keys?", why: "No key holder.", repaired: false,
}

test("the eval covers the seven cases from the spec", () => {
  assert.deepEqual(EXPECTED_CASES.map((item) => item.reference).sort(), [
    "CD-420089", "CD-420311", "CD-420399", "CD-420437", "CD-420458", "CD-420516", "CD-420656",
  ])
})

test("a finding with the right records, contact, role and policy row scores full marks", () => {
  const score = scoreCase(expected("CD-420516"), result("CD-420516", [siteFinding]))
  assert.equal(score.points, score.max)
  assert.equal(score.max, 3)
})

test("asking the wrong party loses the contact and approval points but keeps the records point", () => {
  const wrong: Finding = {
    ...siteFinding,
    ask: { role: "customer", contactType: "paying_customer", contactRecordId: "cus-005", contactQuote: "cus-005", name: "Customer" },
    policyRow: "customer-side",
  }
  const score = scoreCase(expected("CD-420516"), result("CD-420516", [wrong]))
  assert.deepEqual(score.checks.map((check) => [check.name, check.pass]), [["records", true], ["contact", false], ["approval", false]])
})

test("asking anything on CD-420458 fails the no-re-asking check; nothing to ask passes it", () => {
  assert.equal(scoreCase(expected("CD-420458"), result("CD-420458", [])).points, 1)
  const reask = scoreCase(expected("CD-420458"), result("CD-420458", [siteFinding]))
  assert.deepEqual(reask.checks.map((check) => [check.name, check.pass]), [["no re-asking", false]])
})

test("an order that was not reviewed scores nothing", () => {
  const notReviewed: ReviewResult = { status: "not_reviewed", orderId: "ord", reference: "CD-420516", hash: "h", reason: "not reviewed yet", recordsRead: 30, cost: 0 }
  const score = scoreCase(expected("CD-420516"), notReviewed)
  assert.equal(score.points, 0)
  assert.equal(score.max, 3)
})

test("the case fixtures replay offline through the reviewer and are scored with their cost", async () => {
  const fixtures = await loadFixtures()
  const reviewer = createReviewer({ gateway: createScriptedGateway(fixtures), source: await testReviewSource() })
  const results = []
  for (const item of EXPECTED_CASES) results.push(await reviewer.review(item.reference, { now: NOW }))
  assert.ok(results.every((item) => item.status === "reviewed"), "every case fixture replays")
  const run = scoreRun(results)
  assert.equal(run.cases.length, 7)
  assert.equal(run.max, 19)
  assert.ok(run.points > 0 && run.points <= run.max)
  assert.ok(run.cost > 0)
  // The hand-written fixtures encode the PRD's expected findings, so they score full marks.
  if (fixtures.every((fixture) => fixture.origin === "hand-written")) assert.equal(run.points, run.max)
})
