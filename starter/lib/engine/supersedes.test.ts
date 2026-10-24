// Call results supersede what the call asked about, through `state`, `apply` and the
// overlaid bundle only. A call topic names the records it asks about (a rule's
// sources, the tight-ETA check's tracking observation, a proposal's conflict
// evidence); when the person answers on that topic, the call result supersedes them,
// so the re-review sees one current version. A reported ETA is a typed fact
// (`eta_reported`): the tight-ETA check and R12 read it as a time.
//
// Expected values come from the dataset: CD-420437's latest tracking ETA is
// 2026-10-21T13:58Z (track-x0e9acf00fc4d6673), its promise ends 14:00Z (16:00
// Europe/Berlin); the driver says "about 16:30" local = 14:30Z.

import assert from "node:assert/strict"
import { NO_USAGE, type ChatRequest } from "@/lib/reviewer/gateway"
import type { Engine, OrderState } from "./engine"
import { scriptedChecker, scriptedEar, scriptedPerson, scriptedSpeech, scriptedVoice, testClip } from "./call-testing"
import { createVoiceAgent } from "./voice-agent"
import { demoAnswerer } from "./phone"
import { eachStore, testGateway, type CountingGateway } from "./testing"
import type { CallOptions } from "./call-runner"

const TRACKING_437 = "track-x0e9acf00fc4d6673"
const LATE = "I'm stuck after an accident on the motorway. I'll be there about half past four."

async function order(engine: Engine, reference: string): Promise<OrderState> {
  const found = (await engine.state()).orders.find((row) => row.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

async function overlaid(engine: Engine, orderId: string, collection: string, id: string) {
  const bundle = engine.bundle(orderId)
  assert.ok(bundle)
  const row = (await engine.overlaid(bundle)).related[collection]?.find((item) => item.id === id)
  assert.ok(row, `${id} is on the overlaid order`)
  return row.details
}

function caseFileOf(request: ChatRequest): string {
  return request.messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n")
}

/**
 * The scripted reviewer, reacting like the real model did: when CD-420437's case file
 * shows the 13:58 tracking ETA as current next to the driver's later word, it raises
 * "arrival conflicts with the ETA" and asks the driver again.
 */
async function twoEtasGateway(): Promise<CountingGateway> {
  const inner = await testGateway()
  const calls: ChatRequest[] = []
  return {
    calls,
    async chat(request) {
      calls.push(request)
      const file = request.subject === "CD-420437" ? caseFileOf(request) : ""
      const trackingLine = file.split("\n").find((line) => line.startsWith(`[${TRACKING_437}]`)) ?? ""
      const driverSaid = /16:30/.test(file)
      if (!driverSaid || !trackingLine || /SUPERSEDED/.test(trackingLine)) return inner.chat(request)
      const finding = {
        title: "The driver's arrival conflicts with the ETA",
        conflict: [{ record_id: TRACKING_437, field: "estimated_delivery_at", quote: "2026-10-21T13:58:00Z" }],
        ask: { role: "driver", contact_type: "driver", contact_record_id: "asg-x549c66a8c16a3848", contact_quote: "drv-367", name: "Driver drv-367" },
        who_pays: "The driver does not pay Bahn.", policy_row: "driver-routine",
        question: "Which arrival time is right: 15:58 from tracking, or later?",
        why: "Two current ETAs disagree.",
      }
      const args = JSON.stringify({ summary: "Two ETAs disagree.", findings: [finding] })
      return {
        model: "scripted", finishReason: "tool_calls", usage: { ...NO_USAGE, cost: 0.002 },
        message: { role: "assistant", content: null, tool_calls: [{ id: "call_eta", type: "function", function: { name: "submit_findings", arguments: args } }] },
      }
    },
  }
}

/** CD-420437's live driver line with a voice agent whose checker hears "about 16:30" and ends the call resolved. */
function lateDriverCalls(): CallOptions {
  const checker = scriptedChecker([{
    heard: LATE, claims: ["Stuck after an accident on the motorway", "Expects to arrive around 16:30 local"],
    eta: { local: "16:30", claim: "Expects to arrive around 16:30 local" },
    next: "resolved", reply: "Thank you, I've noted that you expect to arrive around half past four. Goodbye.",
    summary: "Stuck after an accident; expects to arrive around 16:30 local, after the promise.",
  }])
  return {
    person: scriptedPerson({}), speech: scriptedSpeech(), answererFor: demoAnswerer({ "CD-420437": ["driver"] }),
    voice: createVoiceAgent({ voice: scriptedVoice(["Okay."]), ear: scriptedEar([LATE]), checker }),
  }
}

/** Rings CD-420437's driver live: "now is fine", "2 No" (tier 2), then the driver's one spoken turn. */
async function callLateDriver(engine: Engine): Promise<OrderState> {
  await engine.apply({ type: "review" })
  const id = (await order(engine, "CD-420437")).id
  await engine.apply({ type: "startCall", orderId: id, line: "driver", live: true })
  const call = (await engine.phone("driver")).current!
  await engine.apply({ type: "callEvent", callId: call.id, input: { type: "answer" } })
  await engine.apply({ type: "callEvent", callId: call.id, input: { type: "key", digit: "1" } })
  await engine.apply({ type: "callEvent", callId: call.id, input: { type: "key", digit: "2" } })
  await engine.apply({ type: "voiceTurn", callId: call.id, audio: testClip() })
  return order(engine, "CD-420437")
}

eachStore("CD-420437: the driver's 16:30 supersedes the 13:58 tracking ETA; the re-review sees one ETA and no new driver call opens", async (engine, gateway) => {
  const after = await callLateDriver(engine)
  assert.equal(after.calls[0].outcome, "resolved")

  // The reported ETA is a typed fact, stated by the driver, superseding the tracking record.
  const eta = after.effects.find((event) => event.type === "eta_reported")
  assert.ok(eta && eta.type === "eta_reported", "the driver's ETA is committed as eta_reported")
  assert.equal(eta.etaAt, "2026-10-21T14:30:00.000Z")
  assert.match(eta.statedBy, /Thomas Mellervik/)
  assert.deepEqual(eta.supersedes, [TRACKING_437])
  assert.equal((await overlaid(engine, after.id, "tracking_observations", TRACKING_437)).superseded_by, eta.id)

  // The re-review read the tracking ETA as superseded history: one current ETA.
  const reread = gateway.calls.filter((request) => request.subject === "CD-420437").at(-1)!
  const trackingLine = caseFileOf(reread).split("\n").find((line) => line.startsWith(`[${TRACKING_437}]`))
  assert.match(trackingLine ?? "", /SUPERSEDED by/)
  assert.ok(!after.proposals.some((proposal) => proposal.kind === "call" && proposal.status !== "dismissed"), "no new driver call proposal")

  // No driver topic is open again; the remaining issue is 16:30 after the 16:00 promise, for the operator.
  const driver = after.callLines.find((line) => line.line === "driver")!
  assert.deepEqual(driver.open, [])
  assert.equal(driver.status, "done")
  const r12 = after.rules.find((rule) => rule.id === "R12")!
  assert.equal(r12.outcome, "fail")
  assert.equal(r12.firstAction, "show_person", "the driver already said it: the operator decides what to tell the customer")
  assert.match(r12.detail, /16:30/)
  assert.ok(!after.planned.some((action) => action.kind === "driver_call"), "no planned driver call")
  assert.equal(after.group, "needs_action")
}, { gateway: twoEtasGateway, calls: lateDriverCalls })

// -- The tight-ETA check reads the current ETA ------------------------------------

// CD-420710: latest tracking ETA 14:00Z (track-x56c8d69e1b8f685e), right at its promise end.
const TRACKING_710 = "track-x56c8d69e1b8f685e"

eachStore("the tight-ETA check stops once a reported 16:30 supersedes the tracking ETA; R12 then reads 16:30 as a time", async (engine) => {
  const before = await order(engine, "CD-420710")
  const check = before.callLines.find((line) => line.line === "driver")
  assert.equal(check?.status, "on_request", "a tight ETA at the snapshot")
  assert.deepEqual(check.open.map((topic) => topic.records), [[TRACKING_710]], "the check names the tracking observation it read")

  const write = { orderId: before.id, source: "test", statedBy: "Driver (driver)", statedAt: "2026-10-21T09:00:00Z", supersedes: [TRACKING_710] }
  await assert.rejects(engine.apply({ type: "recordEffect", effect: { type: "eta_reported", etaAt: "about half past four", ...write } }), /an ETA needs a time/)
  await engine.apply({ type: "recordEffect", effect: { type: "eta_reported", etaAt: "2026-10-21T14:30:00Z", ...write } })

  const after = await order(engine, "CD-420710")
  assert.ok(!after.callLines.some((line) => line.open.some((topic) => topic.id === "check:on_time")), "no on-time check any more")
  assert.equal((await overlaid(engine, after.id, "tracking_observations", TRACKING_710)).superseded_by, after.effects[0].id)
  assert.equal(after.effects[0].version, 2, "version 2 of the car's ETA (1 is tracking)")
  const r12 = after.rules.find((rule) => rule.id === "R12")!
  assert.equal(r12.outcome, "fail")
  assert.equal(r12.firstAction, "show_person")
  assert.deepEqual(r12.sources.map((source) => source.id)[0], after.effects[0].id, "R12 read the reported ETA, not the superseded tracking row")

  // A newer report on the same fact: version 3, and back inside the promise.
  await engine.apply({ type: "recordEffect", effect: { type: "eta_reported", etaAt: "2026-10-21T13:00:00Z", ...write, statedAt: "2026-10-21T09:30:00Z", supersedes: [] } })
  const later = await order(engine, "CD-420710")
  assert.equal(later.effects.at(-1)!.version, 3)
  assert.equal(later.rules.find((rule) => rule.id === "R12")!.outcome, "pass")
})

// -- A rule topic supersedes what the rule read ---------------------------------

const TRACKING_806 = "track-xf0422caacf2d28ce"
const ASSIGNMENT_806 = "asg-xe3fc0243030c60ad"

eachStore("a rule topic names its source records: CD-420806's driver says on track, and the stale tracking row R10 read is superseded", async (engine) => {
  const before = await order(engine, "CD-420806")
  const topic = before.callLines.find((line) => line.line === "driver")!.open.find((row) => row.id === "rule:R10")
  assert.ok(topic, "R10 plans a driver call")
  assert.deepEqual(topic.records, [TRACKING_806], "the topic asks about the latest position R10 read")

  await engine.apply({ type: "startCall", orderId: before.id, line: "driver", live: true })
  const call = (await engine.phone("driver")).current!
  for (const input of [{ type: "answer" }, { type: "key", digit: "1" }, { type: "key", digit: "1" }] as const) {
    await engine.apply({ type: "callEvent", callId: call.id, input })
  }

  const after = await order(engine, "CD-420806")
  assert.equal(after.calls[0].outcome, "resolved")
  const result = after.effects.find((event) => event.type === "call_result_recorded")
  assert.ok(result, "the call result is committed")
  assert.deepEqual(result.supersedes, [TRACKING_806])
  assert.equal((await overlaid(engine, after.id, "tracking_observations", TRACKING_806)).superseded_by, result.id)
  assert.equal((await overlaid(engine, after.id, "work_assignments", ASSIGNMENT_806)).superseded_by, undefined, "the assignment is the order's structure, not a statement")
  assert.equal(after.callLines.find((line) => line.line === "driver")!.status, "done")
}, { calls: () => ({ person: scriptedPerson({}), speech: scriptedSpeech(), answererFor: demoAnswerer({ "CD-420806": ["driver"] }) }) })
