// Tier 2, the voice agent (ticket 12), through `state`, `apply` and `phone` only.
// The audio model, the ear (transcription), the checker (Haiku through the
// ModelGateway) and speech are scripted: no network. Expected values come from the
// spec (story 71: CD-420437 "can you still deliver on time?") and the dataset.

import assert from "node:assert/strict"
import { test } from "node:test"
import type { Engine, OrderState } from "./engine"
import { scriptedChecker, scriptedEar, scriptedPerson, scriptedSpeech, scriptedVoice, testClip } from "./call-testing"
import { createVoiceAgent } from "./voice-agent"
import { demoAnswerer } from "./phone"
import { testEngine } from "./testing"
import type { CallOptions } from "./call-runner"

async function order(engine: Engine, reference: string): Promise<OrderState> {
  const found = (await engine.state()).orders.find((row) => row.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

function engineWith(calls: CallOptions = {}): Promise<Engine> {
  return testEngine({ calls: { person: scriptedPerson({}), speech: scriptedSpeech(), answererFor: demoAnswerer({ "CD-420437": ["driver"] }), ...calls } })
}

test("CD-420437's driver line waits for the operator: the ETA leaves two minutes before the promise ends", async () => {
  const engine = await engineWith()
  const before = await order(engine, "CD-420437")
  const line = before.callLines.find((row) => row.line === "driver")
  assert.ok(line, "a tight ETA gives the order a driver line")
  assert.equal(line.status, "on_request")
  assert.match(line.text, /13:58 UTC.*2 min before the promise ends at 14:00 UTC/)
  assert.equal(line.callee?.handle, "drv-367")

  await engine.apply({ type: "runCalls" })
  const after = await order(engine, "CD-420437")
  assert.equal(after.calls.length, 0, "the pump does not ring it on its own")
  assert.equal(after.group, before.group, "a line on request holds nothing")
})

test("a tight ETA (10 min or less before the promise end) puts CD-420437 and CD-420710 on request", async () => {
  const engine = await engineWith()
  const onRequest = (await engine.state()).orders.filter((row) => row.callLines.some((line) => line.status === "on_request")).map((row) => row.reference)
  assert.deepEqual(onRequest, ["CD-420437", "CD-420710"])
})

/** Rings CD-420437's driver live, answers, says now is fine and presses 2: "no, I can't make it". */
async function toTier2(engine: Engine) {
  const id = (await order(engine, "CD-420437")).id
  await engine.apply({ type: "startCall", orderId: id, line: "driver", live: true })
  let call = (await engine.phone("driver")).current!
  assert.equal(call.reference, "CD-420437")
  await engine.apply({ type: "callEvent", callId: call.id, input: { type: "answer" } })
  await engine.apply({ type: "callEvent", callId: call.id, input: { type: "key", digit: "1" } })
  call = (await engine.phone("driver")).current!
  assert.match(call.expecting?.type === "key" ? call.expecting.text : "", /still deliver within the promised window/)
  await engine.apply({ type: "callEvent", callId: call.id, input: { type: "key", digit: "2" } })
  return (await engine.phone("driver")).current
}

test("a reported problem moves the live call to tier 2: the voice agent greets the driver and waits for speech", async () => {
  const engine = await engineWith({ voice: createVoiceAgent({ voice: scriptedVoice([]), ear: scriptedEar([]), checker: scriptedChecker([]) }) })
  const call = await toTier2(engine)
  assert.ok(call, "the call is still on the phone")
  assert.equal(call.state, "tier2")
  assert.equal(call.tier, 2)
  assert.deepEqual(call.expecting, { type: "speech" })
  const opener = call.transcript.at(-1)!
  assert.equal(opener.by, "agent")
  assert.equal(opener.tier, 2)
  assert.ok(opener.audioId, "the opener is spoken")
  assert.match(opener.text, /what('s| is) happening/i)

  const row = await order(engine, "CD-420437")
  assert.equal(row.group, "in_progress")
  assert.match(row.reason, /Calling Thomas Mellervik \(tier 2\)/)
})

const LATE = "I'm stuck in traffic after an accident, I'll be about forty minutes late, around half past four."
const NEW_ETA = { title: "Record the driver's new ETA", change: "Driver expects to deliver at about 16:30 local, after the promise ends at 16:00.", claim: "Expects to arrive around 16:30 local" }

test("each spoken turn is transcribed, answered aloud by the audio model and checked; its cost goes on the meter", async () => {
  const voice = scriptedVoice(["I'm sorry to hear that. Is the road moving again, or are you still stopped?"])
  const ear = scriptedEar([LATE])
  const checker = scriptedChecker([{ heard: LATE, claims: ["Stuck in traffic after an accident", "Expects to arrive around 16:30 local"], conflicts: ["The ETA on record is 15:58 local"], replyOk: true }])
  const engine = await engineWith({ voice: createVoiceAgent({ voice, ear, checker }) })
  const before = (await toTier2(engine))!
  const clip = testClip(3)

  await engine.apply({ type: "voiceTurn", callId: before.id, audio: clip })

  const call = (await engine.phone("driver")).current!
  assert.equal(call.state, "tier2")
  assert.deepEqual(call.expecting, { type: "speech" }, "the driver's turn again")
  const added = call.transcript.slice(before.transcript.length)
  assert.deepEqual(added.map((line) => line.by), ["callee", "system", "agent"])
  assert.equal(added[0].text, LATE, "what the driver said, from the ear")
  assert.deepEqual(added[1].check?.claims, ["Stuck in traffic after an accident", "Expects to arrive around 16:30 local"])
  assert.deepEqual(added[1].check?.conflicts, ["The ETA on record is 15:58 local"])
  assert.equal(added[1].check?.next, "continue")
  assert.equal(added[2].text, "I'm sorry to hear that. Is the road moving again, or are you still stopped?")
  assert.equal(added[2].audioId, "v00000001", "the audio model's own voice")
  assert.equal(added[2].path, "voice")

  assert.equal(ear.heard[0], clip)
  assert.equal(voice.requests[0].clip, clip, "the audio model hears the recording itself")
  const brief = voice.requests[0].brief
  assert.match(brief, /CD-420437/)
  assert.match(brief, /Latest ETA on record: 15:58/, "times in the driver's zone (Europe/Berlin)")
  assert.match(brief, /Delivery promise to the customer: 11:00 to 16:00/)
  assert.ok(brief.length < 1200, "a short brief, not the case file")
  assert.equal(checker.calls[0].job, "call-check")

  assert.equal(Math.round((call.cost.modelUsd - before.cost.modelUsd) * 1e6) / 1e6, 0.00165, "ear $0.00005 + checker $0.001 + audio model $0.0006")
  assert.ok(call.cost.phoneSeconds > before.cost.phoneSeconds + 3, "the driver's 3 s of speech is phone time")
})

test("the agent never agrees to a change: a reply that does is replaced, and the change becomes a proposal for the operator's yes", async () => {
  const voice = scriptedVoice(["No problem, I'll move your delivery to half past four."])
  const checker = scriptedChecker([{
    heard: LATE, claims: ["Expects to arrive around 16:30 local"], changes: [NEW_ETA], replyOk: false,
    replyIssue: "The draft agrees to move the delivery.", next: "resolved",
    reply: "Thank you, I've noted that you expect to arrive around half past four. A colleague will review it with the customer. Goodbye.",
    summary: "Stuck in traffic after an accident; expects to arrive around 16:30 local, after the promise.",
  }])
  const speech = scriptedSpeech()
  const engine = await engineWith({ speech, voice: createVoiceAgent({ voice, ear: scriptedEar([LATE]), checker }) })
  const call = (await toTier2(engine))!

  await engine.apply({ type: "voiceTurn", callId: call.id, audio: testClip() })

  assert.equal((await engine.phone("driver")).current, null, "the call ended")
  const row = await order(engine, "CD-420437")
  const ended = row.calls[0]
  assert.equal(ended.outcome, "resolved")
  assert.equal(ended.tier, 2)
  assert.ok(!ended.transcript.some((line) => /I'll move your delivery/.test(line.text)), "the agreeing reply is never said")
  const reply = ended.transcript.filter((line) => line.by === "agent").at(-1)!
  assert.match(reply.text, /A colleague will review it/)
  assert.ok(speech.spoken.includes(reply.text), "spoken by text to speech instead")
  assert.equal(reply.path, "replaced")
  assert.match(ended.transcript.find((line) => line.check)?.text ?? "", /Audio reply not used/)
  assert.deepEqual(ended.changes, [NEW_ETA])
  assert.match(ended.summary ?? "", /expects to arrive around 16:30/)

  const change = row.proposals.find((proposal) => proposal.kind === "change")
  assert.ok(change, "the new ETA waits for the operator")
  assert.equal(change.status, "proposed")
  assert.equal(change.change, NEW_ETA.change)
  assert.equal(row.group, "needs_action")
  assert.match(row.reason, /Waiting for your yes/)
  assert.equal(row.callLines.find((line) => line.line === "driver")?.status, "done", "the on-time check is covered")
})

test("when the audio model fails, the ear, the checker and text to speech complete the same call", async () => {
  const voice = scriptedVoice([], "OpenRouter 503: no audio provider available")
  const checker = scriptedChecker([
    { heard: LATE, claims: ["Expects to arrive around 16:30 local"], reply: "I'm sorry to hear that. Are you still stopped, or moving again?", replyOk: null },
    { heard: "Moving again slowly.", claims: ["Expects to arrive around 16:30 local", "Traffic is moving again slowly"], changes: [NEW_ETA], next: "resolved", reply: "Thank you, I've noted it. Goodbye.", summary: "Late after an accident; expects 16:30 local." },
  ])
  const speech = scriptedSpeech()
  const engine = await engineWith({ speech, voice: createVoiceAgent({ voice, ear: scriptedEar([LATE, "Moving again slowly."]), checker }) })
  const call = (await toTier2(engine))!

  await engine.apply({ type: "voiceTurn", callId: call.id, audio: testClip() })
  const middle = (await engine.phone("driver")).current!
  const reply = middle.transcript.at(-1)!
  assert.equal(reply.path, "fallback")
  assert.equal(reply.text, "I'm sorry to hear that. Are you still stopped, or moving again?")
  assert.ok(reply.audioId?.startsWith("a"), "spoken by text to speech")
  assert.ok(speech.spoken.includes(reply.text))

  await engine.apply({ type: "voiceTurn", callId: call.id, audio: testClip() })
  const ended = (await order(engine, "CD-420437")).calls[0]
  assert.equal(ended.outcome, "resolved")
  assert.deepEqual(ended.claims.slice(-2), ["Expects to arrive around 16:30 local", "Traffic is moving again slowly"])
  assert.ok(ended.transcript.filter((line) => line.path).every((line) => line.path === "fallback"))
})

test("an unresolved tier-2 call ends politely as a handover with the open question and a next step (ticket 14 picks it up)", async () => {
  const checker = scriptedChecker([{
    heard: "The customer wants a different address now, I need to talk to someone.", claims: ["Customer asked the driver for a different delivery address"],
    next: "handover", reply: "Thank you. A colleague from the control room will call you back shortly to settle this. Goodbye.",
    openQuestion: "May the driver deliver to the new address the customer gave?", nextStep: "Confirm the address with the customer, then call the driver back.",
    summary: "The customer asked the driver to deliver to a different address.",
  }])
  const engine = await engineWith({ voice: createVoiceAgent({ voice: scriptedVoice(["Okay."]), ear: scriptedEar(["The customer wants a different address now, I need to talk to someone."]), checker }) })
  const call = (await toTier2(engine))!
  await engine.apply({ type: "voiceTurn", callId: call.id, audio: testClip() })

  const row = await order(engine, "CD-420437")
  const ended = row.calls[0]
  assert.equal(ended.outcome, "handover")
  assert.deepEqual(ended.handover, {
    question: "May the driver deliver to the new address the customer gave?",
    nextStep: "Confirm the address with the customer, then call the driver back.",
    summary: "The customer asked the driver to deliver to a different address.",
  })
  assert.match(ended.transcript.filter((line) => line.by === "agent").at(-1)!.text, /colleague .* call you back/)
  assert.equal(row.callLines.find((line) => line.line === "driver")?.status, "needs_person")
  assert.equal(row.group, "needs_action")
})

test("tier 2 takes only speech or a hang-up; a hang-up hands the call over", async () => {
  const engine = await engineWith({ voice: createVoiceAgent({ voice: scriptedVoice([]), ear: scriptedEar([]), checker: scriptedChecker([]) }) })
  const call = (await toTier2(engine))!
  await assert.rejects(engine.apply({ type: "callEvent", callId: call.id, input: { type: "key", digit: "1" } }), /listening/)
  await engine.apply({ type: "callEvent", callId: call.id, input: { type: "hang_up" } })
  const ended = (await order(engine, "CD-420437")).calls[0]
  assert.equal(ended.outcome, "handover")
  assert.match(ended.handover?.question ?? "", /hung up/)
  await assert.rejects(engine.apply({ type: "voiceTurn", callId: call.id, audio: testClip() }), /not listening/)
})

test("a failed check gives a safe reply and records nothing; the turn limit hands the call over", async () => {
  const failing = { async chat(): Promise<never> { throw new Error("OpenRouter 500") } }
  const engine = await engineWith({ voice: createVoiceAgent({ voice: scriptedVoice(["Sure, I'll tell the customer you're late."]), ear: scriptedEar(["one", "two"]), checker: failing, maxTurns: 2 }) })
  const call = (await toTier2(engine))!
  await engine.apply({ type: "voiceTurn", callId: call.id, audio: testClip() })
  const first = (await engine.phone("driver")).current!
  const check = first.transcript.find((line) => line.check)!
  assert.deepEqual(check.check?.claims, [])
  assert.match(check.text, /Check failed/)
  assert.ok(!first.transcript.some((line) => /I'll tell the customer/.test(line.text)), "an unchecked reply is not said")

  await engine.apply({ type: "voiceTurn", callId: call.id, audio: testClip() })
  const ended = (await order(engine, "CD-420437")).calls[0]
  assert.equal(ended.outcome, "handover", "two turns without settling: a person follows up")
})

test("without a voice agent a reported problem still ends as a handover", async () => {
  const engine = await engineWith()
  const call = await toTier2(engine)
  assert.equal(call, null, "the phone is free")
  const [ended] = (await order(engine, "CD-420437")).calls
  assert.equal(ended.outcome, "handover")
  assert.ok(ended.path.includes("tier2"))
})
