import assert from "node:assert/strict"
import { before, test } from "node:test"
import { loadFixtures, SCENARIO_FIXTURE_DIR, type Fixture } from "./fixtures"
import type { ChatMessage } from "./gateway"
import { createMemoryReviewCache } from "./cache"
import { createReviewer, type ReviewResult, type Reviewed } from "./reviewer"
import { createScriptedGateway } from "./scripted"
import { testReviewSource } from "./testing"

const NOW = "2026-10-21T09:00:00.000Z"

let fixtures: Fixture[] = []

before(async () => {
  fixtures = await loadFixtures(SCENARIO_FIXTURE_DIR)
  // Tests never reach the network: any fetch is a bug.
  globalThis.fetch = (() => { throw new Error("network call in a reviewer test") }) as typeof fetch
})

async function setup(extra: Fixture[] = []) {
  const gateway = createScriptedGateway([...fixtures, ...extra])
  const cache = createMemoryReviewCache()
  const reviewer = createReviewer({ gateway, source: await testReviewSource(), cache })
  return { gateway, cache, reviewer }
}

function reviewed(result: ReviewResult): Reviewed {
  assert.equal(result.status, "reviewed", result.status === "not_reviewed" ? result.reason : "")
  return result as Reviewed
}

function text(message: ChatMessage): string {
  return typeof message.content === "string" ? message.content : (message.content ?? []).map((part) => part.text).join("")
}

test("a finding cites the records that disagree and the record that names who to ask, with its cost", async () => {
  const { reviewer, gateway } = await setup()
  const result = reviewed(await reviewer.review("CD-420516", { now: NOW }))
  assert.equal(result.reference, "CD-420516")
  assert.equal(result.findings.length, 1)
  const [finding] = result.findings
  assert.deepEqual(finding.conflict.map((item) => item.recordId), [
    "note-x7b4b75e5977108cd", "msg-x96d66b17e32a5df4", "msg-x5d8006558b9e7cc6", "ep-xf77895617a67a311", "site-001",
  ])
  assert.equal(finding.ask.role, "site")
  assert.equal(finding.ask.contactRecordId, "ep-xf77895617a67a311")
  assert.equal(finding.policyRow, "site-routine")
  assert.equal(finding.repaired, false)
  assert.equal(result.cost, 0.0213)
  assert.equal(result.cached, false)
  assert.equal(result.toolCalls, 0)
  assert.ok(result.recordsRead > 20)
  assert.equal(gateway.calls.length, 1)
})

test("the reviewer sends a cached system prompt, the case file first, the read-only tools and medium effort", async () => {
  const { reviewer, gateway } = await setup()
  await reviewer.review("CD-420516", { now: NOW })
  const [request] = gateway.calls
  assert.equal(request.job, "reviewer")
  assert.equal(request.subject, "CD-420516")
  assert.equal(request.effort, "medium")
  const [system, user] = request.messages
  assert.equal(system.role, "system")
  assert.ok(Array.isArray(system.content) && system.content.at(-1)?.cache_control?.type === "ephemeral")
  assert.match(text(system), /customer-side/)
  assert.equal(user.role, "user")
  assert.match(text(user), /^# Case file CD-420516/)
  assert.deepEqual(request.tools?.map((tool) => tool.function.name).sort(), [
    "get_driver_duties", "get_inbox_threads", "get_policy", "get_related_orders", "get_site_profile", "submit_findings",
  ])
})

test("a finding with a missing record id gets one repair attempt and is kept once repaired", async () => {
  const { reviewer, gateway } = await setup()
  const result = reviewed(await reviewer.review("CD-420437", { now: NOW }))
  assert.equal(gateway.calls.length, 2)
  const feedback = gateway.calls[1].messages.at(-1)
  assert.equal(feedback?.role, "tool")
  assert.match(text(feedback!), /record msg-x0049fe6fc2fd0b0f does not exist/)
  assert.equal(result.findings.length, 1)
  const [finding] = result.findings
  assert.equal(finding.repaired, true)
  assert.equal(finding.ask.role, "customer")
  assert.equal(finding.policyRow, "customer-side")
  assert.ok(finding.conflict.some((item) => item.recordId === "msg-x0049fe6fc2fd0b0e"))
  assert.deepEqual(result.dropped, [])
})

test("a finding with a wrong quote that still fails after its repair is dropped", async () => {
  const { reviewer, gateway } = await setup()
  const result = reviewed(await reviewer.review("CD-420399", { now: NOW }))
  assert.equal(gateway.calls.length, 2)
  assert.deepEqual(result.findings.map((finding) => finding.ask.role), ["driver"])
  assert.equal(result.findings[0].repaired, false)
  assert.equal(result.dropped.length, 1)
  assert.match(result.dropped[0].errors.join(" "), /is not in expense-x9d676667cdd4f893/)
})

test("a customer-given contact classed as a third-party site fails the check (ADR 0001)", async () => {
  const misclassed: Fixture = {
    reference: "CD-420437", origin: "hand-written", note: "Test-only: Celia Hollowmere classed as a site.",
    turns: [0, 1].map((n) => ({
      message: {
        role: "assistant" as const, content: null,
        tool_calls: [{
          id: `call_${n}`, type: "function" as const,
          function: {
            name: "submit_findings",
            arguments: {
              summary: "Receiver authority unclear.",
              findings: [{
                title: "Who signs on delivery is unknown",
                conflict: [
                  { record_id: "msg-x0049fe6fc2fd0b0e", field: "body", quote: "I still cannot confirm who is authorized to inspect and sign for the car." },
                  { record_id: "ep-x61821adf903f2d7d", field: "contact_name", quote: "Celia Hollowmere" },
                ],
                ask: { role: "site", contact_type: "third_party_site", contact_record_id: "ep-x61821adf903f2d7d", contact_quote: "Celia Hollowmere", name: "Celia Hollowmere" },
                who_pays: "cus-025 pays", policy_row: "site-routine", question: "Can you sign?", why: "Nobody is authorised.",
              }],
            },
          },
        }],
      },
      finishReason: "tool_calls", model: "scripted",
    })),
  }
  const reviewer = createReviewer({ gateway: createScriptedGateway([misclassed]), source: await testReviewSource() })
  const result = reviewed(await reviewer.review("CD-420437", { now: NOW }))
  assert.deepEqual(result.findings, [])
  assert.match(result.dropped[0].errors.join(" "), /is customer_given_contact, not third_party_site/)
})

test("records returned by a read-only tool can be cited", async () => {
  const { reviewer } = await setup()
  const result = reviewed(await reviewer.review("CD-420089", { now: NOW }))
  assert.equal(result.toolCalls, 1)
  const [finding] = result.findings
  assert.equal(finding.ask.role, "operator")
  assert.ok(finding.conflict.some((item) => item.recordId === "step-x88ed7ca82db890c5"), "cites the CD-420719 duty from the tool result")
})

test("nothing to ask is a valid result: an open question is not asked again", async () => {
  const { reviewer } = await setup()
  const result = reviewed(await reviewer.review("CD-420458", { now: NOW }))
  assert.deepEqual(result.findings, [])
  assert.deepEqual(result.dropped, [])
})

/** A fixture whose turns each submit `findings` exactly as given (an array, or a string as some models send). */
function submissions(reference: string, ...findings: unknown[]): Fixture {
  return {
    reference, origin: "hand-written", note: "Test-only submissions.",
    turns: findings.map((value, n) => ({
      message: {
        role: "assistant" as const, content: null,
        tool_calls: [{ id: `call_${n}`, type: "function" as const, function: { name: "submit_findings", arguments: JSON.stringify({ summary: "Test.", findings: value }) } }],
      },
      finishReason: "tool_calls", model: "scripted",
    })),
  }
}

async function scenarioFindings(reference: string): Promise<unknown[]> {
  const fixture = fixtures.find((item) => item.reference === reference)!
  const args = fixture.turns[0].message.tool_calls![0].function.arguments as { findings: unknown[] }
  return structuredClone(args.findings)
}

test("findings sent as a JSON-encoded string are read as the list they encode", async () => {
  const valid = await scenarioFindings("CD-420516")
  const gateway = createScriptedGateway([submissions("CD-420516", JSON.stringify(valid))])
  const reviewer = createReviewer({ gateway, source: await testReviewSource() })
  const result = reviewed(await reviewer.review("CD-420516", { now: NOW }))
  assert.equal(gateway.calls.length, 1)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].ask.contactRecordId, "ep-xf77895617a67a311")
  assert.equal(result.findings[0].repaired, false)
})

test("a JSON-encoded findings string with stray closing brackets after the array is still read", async () => {
  const valid = await scenarioFindings("CD-420516")
  const gateway = createScriptedGateway([submissions("CD-420516", `${JSON.stringify(valid)}}]`)])
  const result = reviewed(await createReviewer({ gateway, source: await testReviewSource() }).review("CD-420516", { now: NOW }))
  assert.equal(gateway.calls.length, 1)
  assert.equal(result.findings.length, 1)
})

test("a submission in the wrong format gets its own retry and still leaves the evidence repair", async () => {
  const valid = await scenarioFindings("CD-420516")
  const wrongQuote = structuredClone(valid) as Array<{ conflict: Array<{ quote: string }> }>
  wrongQuote[0].conflict[0].quote = "Use the front gate"
  const gateway = createScriptedGateway([submissions("CD-420516", "[{\"title\": broken", wrongQuote, valid)])
  const reviewer = createReviewer({ gateway, source: await testReviewSource() })
  const result = reviewed(await reviewer.review("CD-420516", { now: NOW }))
  assert.equal(gateway.calls.length, 3)
  assert.match(text(gateway.calls[1].messages.at(-1)!), /findings must be a list/)
  assert.match(text(gateway.calls[2].messages.at(-1)!), /"Use the front gate" is not in note-x7b4b75e5977108cd/)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].repaired, true)
  assert.deepEqual(result.dropped, [])
})

test("a quote copied as the case file's \"key\":\"value\" text matches that field", async () => {
  const valid = await scenarioFindings("CD-420516") as Array<{ conflict: Array<{ record_id: string; field: string; quote: string }> }>
  valid[0].conflict[3] = { record_id: "ep-xf77895617a67a311", field: "last_confirmed_source", quote: "\"last_confirmed_source\":\"MANAGED_SITE_PROFILE\"" }
  const gateway = createScriptedGateway([submissions("CD-420516", valid)])
  const result = reviewed(await createReviewer({ gateway, source: await testReviewSource() }).review("CD-420516", { now: NOW }))
  assert.equal(gateway.calls.length, 1)
  assert.equal(result.findings.length, 1)
})

test("the repair feedback shows the named field's real value", async () => {
  const valid = await scenarioFindings("CD-420516")
  const wrong = structuredClone(valid) as Array<{ conflict: Array<{ record_id: string; field: string; quote: string }> }>
  wrong[0].conflict[3] = { record_id: "ep-xf77895617a67a311", field: "contact_status", quote: "UNCONFIRMED" }
  const gateway = createScriptedGateway([submissions("CD-420516", wrong, valid)])
  await createReviewer({ gateway, source: await testReviewSource() }).review("CD-420516", { now: NOW })
  assert.match(text(gateway.calls[1].messages.at(-1)!), /"UNCONFIRMED" is not in ep-xf77895617a67a311\.contact_status \(its value is "CONFIRMED"\)/)
})

test("the tool budget of 8 calls is enforced", async () => {
  const lookup = (n: number) => ({ id: `call_${n}`, type: "function" as const, function: { name: "get_site_profile", arguments: { site_id: "site-001" } } })
  const greedy: Fixture = {
    reference: "CD-420516", origin: "hand-written", note: "Test-only: a model that keeps calling tools.",
    turns: [
      { message: { role: "assistant", content: null, tool_calls: [1, 2, 3, 4, 5].map(lookup) }, finishReason: "tool_calls", model: "scripted", usage: { cost: 0.001 } },
      { message: { role: "assistant", content: null, tool_calls: [6, 7, 8, 9, 10].map(lookup) }, finishReason: "tool_calls", model: "scripted", usage: { cost: 0.001 } },
      { message: { role: "assistant", content: null, tool_calls: [{ id: "call_11", type: "function", function: { name: "submit_findings", arguments: { summary: "Nothing to ask.", findings: [] } } }] }, finishReason: "tool_calls", model: "scripted", usage: { cost: 0.001 } },
    ],
  }
  const gateway = createScriptedGateway([greedy])
  const reviewer = createReviewer({ gateway, source: await testReviewSource() })
  const result = reviewed(await reviewer.review("CD-420516", { now: NOW }))
  assert.equal(result.toolCalls, 8)
  assert.equal(result.refusedToolCalls, 2)
  const refusals = gateway.calls[2].messages.filter((message) => message.role === "tool" && /tool budget of 8 calls is used up/.test(text(message)))
  assert.equal(refusals.length, 2)
  // Once the budget is spent, only submit_findings is offered.
  assert.deepEqual(gateway.calls[2].tools?.map((tool) => tool.function.name), ["submit_findings"])
})

test("the same case file is answered from the cache with no model call", async () => {
  const { reviewer, gateway } = await setup()
  const first = reviewed(await reviewer.review("CD-420516", { now: NOW }))
  const again = reviewed(await reviewer.review("CD-420516", { now: NOW }))
  assert.equal(gateway.calls.length, 1)
  assert.equal(again.cached, true)
  assert.equal(again.cost, 0)
  assert.deepEqual(again.findings, first.findings)
  assert.equal(again.hash, first.hash)

  // An operator instruction changes the case file, so the order is reviewed again.
  const instructed = await reviewer.review("CD-420516", {
    now: NOW, prior: { instructions: [{ id: "instr-1", at: "2026-10-21T08:59:00Z", by: "operator", text: "Ask stock control directly." }] },
  })
  assert.equal(gateway.calls.length, 2)
  assert.notEqual(instructed.hash, first.hash)
})

test("with no API key the reviewer reports not reviewed yet, but still serves a cached result", async () => {
  const source = await testReviewSource()
  const cache = createMemoryReviewCache()
  const offline = createReviewer({ gateway: null, source, cache })
  const result = await offline.review("CD-420516", { now: NOW })
  assert.equal(result.status, "not_reviewed")
  assert.match(result.status === "not_reviewed" ? result.reason : "", /^not reviewed yet/)
  assert.equal(result.cost, 0)

  await createReviewer({ gateway: createScriptedGateway(fixtures), source, cache }).review("CD-420516", { now: NOW })
  assert.equal((await offline.review("CD-420516", { now: NOW })).status, "reviewed")
})

test("a failing model call reports not reviewed yet instead of throwing", async () => {
  const reviewer = createReviewer({ gateway: createScriptedGateway([]), source: await testReviewSource() })
  const result = await reviewer.review("CD-420311", { now: NOW })
  assert.equal(result.status, "not_reviewed")
})
