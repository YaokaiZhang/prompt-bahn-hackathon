// Tier-3 handover (ticket 14), through `state` and `apply` only. A scripted tier-2
// call on CD-420437 (story 71: "can you still deliver on time?") ends unresolved;
// the operator gets the handover in Needs action and one urgent push, and the order
// stays there until the operator records what they learned.

import assert from "node:assert/strict"
import type { Engine, OrderState, PushItem } from "./engine"
import { scriptedChecker, scriptedEar, scriptedPerson, scriptedSpeech, scriptedVoice, testClip } from "./call-testing"
import { createVoiceAgent } from "./voice-agent"
import { demoAnswerer } from "./phone"
import { eachStore } from "./testing"
import type { CallOptions } from "./call-runner"

const HEARD = "The customer wants a different address now, I need to talk to someone."
const QUESTION = "May the driver deliver to the new address the customer gave?"
const NEXT_STEP = "Confirm the address with the customer, then call the driver back."
const SUMMARY = "The customer asked the driver to deliver to a different address."

/** Tier 2 on CD-420437's live driver line; the checker hands the first spoken turn over. */
function handoverCalls(): CallOptions {
  const checker = scriptedChecker([{
    heard: HEARD, claims: ["Customer asked the driver for a different delivery address"], next: "handover",
    reply: "Thank you. A colleague from the control room will call you back shortly to settle this. Goodbye.",
    openQuestion: QUESTION, nextStep: NEXT_STEP, summary: SUMMARY,
  }])
  return {
    person: scriptedPerson({}), speech: scriptedSpeech(), answererFor: demoAnswerer({ "CD-420437": ["driver"] }),
    voice: createVoiceAgent({ voice: scriptedVoice(["Okay."]), ear: scriptedEar([HEARD]), checker }),
  }
}

async function order(engine: Engine, reference: string): Promise<OrderState> {
  const found = (await engine.state()).orders.find((row) => row.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

/** Rings the driver live, answers, "now is fine", "2 No, I can't make it" (tier 2), then one spoken turn. */
async function handOver(engine: Engine): Promise<string> {
  const id = (await order(engine, "CD-420437")).id
  await engine.apply({ type: "startCall", orderId: id, line: "driver", live: true })
  const callId = (await engine.phone("driver")).current!.id
  await engine.apply({ type: "callEvent", callId, input: { type: "answer" } })
  await engine.apply({ type: "callEvent", callId, input: { type: "key", digit: "1" } })
  await engine.apply({ type: "callEvent", callId, input: { type: "key", digit: "2" } })
  await engine.apply({ type: "voiceTurn", callId, audio: testClip() })
  return callId
}

const handoverPushes = async (engine: Engine): Promise<PushItem[]> =>
  (await engine.state()).briefing.items.filter((item): item is PushItem => item.kind === "push" && item.reason === "handover")

eachStore("a handover arriving sends one urgent push naming the order and the open question", async (engine) => {
  const callId = await handOver(engine)

  const pushes = await handoverPushes(engine)
  assert.equal(pushes.length, 1)
  const [push] = pushes
  assert.equal(push.reference, "CD-420437")
  assert.equal(push.title, "CD-420437: handover from a call")
  assert.match(push.text, /Thomas Mellervik/)
  assert.match(push.text, /May the driver deliver to the new address/)
  assert.equal(push.at, await engine.clock(), "it arrives at the demo time the call ended")
  assert.equal(push.read, false)
  assert.ok(callId)
}, { calls: handoverCalls })

eachStore("the handover lands in Needs action with the transcript, summary, open question and proposed next step (tier 3)", async (engine) => {
  const callId = await handOver(engine)

  const row = await order(engine, "CD-420437")
  assert.equal(row.group, "needs_action")
  assert.match(row.reason, /^Handover from the call with Thomas Mellervik: May the driver deliver to the new address the customer gave\?/)
  const call = row.calls.find((entry) => entry.id === callId)!
  assert.equal(call.outcome, "handover")
  assert.equal(call.tier, 3, "a handed-over call is at tier 3")
  assert.deepEqual(
    { question: call.handover?.question, nextStep: call.handover?.nextStep, summary: call.handover?.summary, closed: call.handover?.closed },
    { question: QUESTION, nextStep: NEXT_STEP, summary: SUMMARY, closed: null },
  )
  assert.ok(call.transcript.some((line) => line.by === "callee" && line.text === HEARD), "the full transcript, with what the driver said")
  assert.match(call.transcript.filter((line) => line.by === "agent").at(-1)!.text, /colleague .* call you back/, "ended politely")
  assert.equal(row.callLines.find((entry) => entry.line === "driver")?.status, "handover")
}, { calls: handoverCalls })

const LEARNED = "Called the customer: deliver to the original address as booked. Told the driver."

eachStore("an open handover holds the order in Needs action until the operator records what they learned", async (engine) => {
  const groupBefore = (await order(engine, "CD-420437")).group
  const callId = await handOver(engine)

  // Time passes and the agent keeps working: the handover stays with the operator, nobody calls the driver again.
  await engine.apply({ type: "advanceClock", minutes: 60 })
  await engine.apply({ type: "runCalls" })
  let row = await order(engine, "CD-420437")
  assert.equal(row.group, "needs_action")
  assert.match(row.reason, /^Handover from the call with Thomas Mellervik/)
  assert.equal(row.calls.length, 1, "no new call while the handover is open")
  assert.equal((await handoverPushes(engine)).length, 1, "still one push")

  await engine.apply({ type: "recordHandoverResult", callId, result: LEARNED })

  row = await order(engine, "CD-420437")
  assert.equal(row.group, groupBefore, `the operator acted: back where it was before the call (${row.reason})`)
  assert.match(row.reason, /^Handover closed by the operator: Called the customer/)
  const line = row.callLines.find((entry) => entry.line === "driver")!
  assert.equal(line.status, "done")
  const closed = row.calls[0].handover?.closed
  assert.ok(closed, "the handover shows it was closed")
  assert.equal(closed.result, LEARNED)
  assert.equal(closed.at, await engine.clock())

  // What the operator learned is committed as the call's result, by the operator, a new version over the agent's record of the call.
  const fromCall = row.effects.filter((event) => event.source === callId)
  const agent = fromCall.find((event) => event.by === "agent")
  const operator = fromCall.find((event) => event.by === "operator")
  assert.ok(agent, "the agent recorded what the driver said on the call")
  assert.ok(operator, "the operator's result is an effect event")
  assert.equal(operator.id, closed.effectId)
  assert.equal(operator.type, "call_result_recorded")
  assert.equal(operator.type === "call_result_recorded" && operator.claim, LEARNED)
  assert.equal(operator.type === "call_result_recorded" && operator.callId, callId)
  assert.equal(operator.fact.key, agent.fact.key, "the same point the call was about")
  assert.equal(operator.version, agent.version + 1)
  assert.ok(operator.supersedes.includes(agent.id), "it names the agent's record it supersedes")
  assert.ok(row.history.some((entry) => entry.effectId === operator.id && entry.by === "operator"))
  assert.equal((await handoverPushes(engine)).length, 1, "closing sends nothing")
}, { calls: handoverCalls })

eachStore("closing a handover needs a result, an open handover and a handed-over call", async (engine) => {
  const callId = await handOver(engine)
  await assert.rejects(engine.apply({ type: "recordHandoverResult", callId, result: "  " }), /cannot be empty/)
  await assert.rejects(engine.apply({ type: "recordHandoverResult", callId: "call-nope", result: LEARNED }), /No call call-nope/)
  await engine.apply({ type: "recordHandoverResult", callId, result: LEARNED })
  await assert.rejects(engine.apply({ type: "recordHandoverResult", callId, result: "again" }), /already closed/)
}, { calls: handoverCalls })

/** Rings CD-420437's driver live and presses through to "2 No, I can't make it". */
async function reportProblem(engine: Engine): Promise<string> {
  const id = (await order(engine, "CD-420437")).id
  await engine.apply({ type: "startCall", orderId: id, line: "driver", live: true })
  const callId = (await engine.phone("driver")).current!.id
  await engine.apply({ type: "callEvent", callId, input: { type: "answer" } })
  await engine.apply({ type: "callEvent", callId, input: { type: "key", digit: "1" } })
  await engine.apply({ type: "callEvent", callId, input: { type: "key", digit: "2" } })
  return callId
}

eachStore("without a voice agent a reported problem on the keypad is a tier-3 handover too: it ends politely and pushes once", async (engine) => {
  await reportProblem(engine)

  const row = await order(engine, "CD-420437")
  const call = row.calls[0]
  assert.equal(call.outcome, "handover")
  assert.equal(call.tier, 3)
  assert.match(call.transcript.filter((line) => line.by === "agent").at(-1)!.text, /colleague from the control room will follow up with you/)
  assert.match(call.handover?.question ?? "", /^Driver cannot deliver within the promised window/)
  assert.match(call.handover?.nextStep ?? "", /^Call Thomas Mellervik back/)
  assert.equal(call.handover?.closed, null)
  assert.equal(row.group, "needs_action")
  assert.match(row.reason, /^Handover from the call with Thomas Mellervik: Driver cannot deliver/)
  assert.equal((await handoverPushes(engine)).length, 1)
}, { calls: () => ({ person: scriptedPerson({}), speech: scriptedSpeech(), answererFor: demoAnswerer({ "CD-420437": ["driver"] }) }) })

eachStore("the next digest counts an open handover as its own cause in Needs action", async (engine) => {
  await handOver(engine)
  const noon = async () => (await engine.state()).briefing.items.find((item) => item.kind === "digest" && item.slot === "12:00")
  for (let i = 0; i < 10 && !(await noon()); i++) await engine.apply({ type: "advanceToNextDue" })
  const digest = await noon()
  assert.ok(digest && digest.kind === "digest", "the 12:00 digest arrived")
  assert.deepEqual(digest.facts.needsActionBy.find((row) => row.label === "Handover from a call"), { label: "Handover from a call", count: 1 })
}, { calls: handoverCalls })
