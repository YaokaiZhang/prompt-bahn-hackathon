// The mock phone, live tier 1 (ticket 11), through `state`, `apply` and `phone`
// only. Demo cases and calls the operator marks "ring live" ring on the Site or
// Driver persona's phone; everything else is answered by the simulated person.
// Each phone takes one live call at a time; a ringing call rings out on its own.

import assert from "node:assert/strict"
import { test } from "node:test"
import type { Engine, OrderState } from "./engine"
import { scriptedPerson, scriptedSpeech } from "./call-testing"
import { demoAnswerer } from "./phone"
import { eachStore, testEngine, testGateway } from "./testing"
import type { CallOptions } from "./call-runner"

async function order(engine: Engine, reference: string): Promise<OrderState> {
  const found = (await engine.state()).orders.find((row) => row.reference === reference)
  assert.ok(found, `${reference} is in the snapshot`)
  return found
}

function phoneEngine(calls: CallOptions = {}, gateway = false): Promise<Engine> {
  return (async () => testEngine({
    ...(gateway ? { gateway: await testGateway() } : {}),
    calls: { person: scriptedPerson({}), speech: scriptedSpeech(), answererFor: demoAnswerer(), ...calls },
  }))()
}

test("demo cases ring live on the persona's phone; background calls stay with the simulated person", async () => {
  const engine = await phoneEngine({}, true)
  await engine.apply({ type: "review" })
  await engine.apply({ type: "runCalls" })

  const keys = (await order(engine, "CD-420516")).calls
  assert.equal(keys.length, 1)
  assert.equal(keys[0].answerer, "live", "CD-420516's key call is a demo case")
  assert.equal(keys[0].state, "ringing", "nobody answered it: it waits for the phone")

  const background = (await order(engine, "CD-420735")).calls
  assert.equal(background[0].answerer, "simulated")
  assert.equal(background[0].state, "ended")

  const site = await engine.phone("site")
  assert.equal(site.current?.id, keys[0].id)
  assert.equal(site.current?.reference, "CD-420516")
  assert.ok(!site.queued.some((call) => call.reference === "CD-420735"))
})

test("CD-420516 runs live end to end: the phone answers and keys in, and the result reaches the order", async () => {
  const engine = await phoneEngine({}, true)
  await engine.apply({ type: "review" })
  await engine.apply({ type: "runCalls" })
  let call = (await engine.phone("site")).current
  assert.ok(call)
  assert.equal(call.reference, "CD-420516")

  await engine.apply({ type: "callEvent", callId: call.id, input: { type: "answer" } })
  call = (await engine.phone("site")).current
  assert.equal(call?.expecting?.type, "key", "the agent asks at once whether now is a good time")
  assert.ok(call?.transcript.at(-1)?.audioId, "the prompt has audio for the phone to play")
  await engine.apply({ type: "callEvent", callId: call!.id, input: { type: "key", digit: "1" } })
  call = (await engine.phone("site")).current
  assert.match(call?.expecting?.type === "key" ? call.expecting.text : "", /keys/)
  await engine.apply({ type: "callEvent", callId: call!.id, input: { type: "key", digit: "3" } })

  const phone = await engine.phone("site")
  assert.equal(phone.current, null, "the phone is free again")
  assert.equal(phone.last?.outcome, "resolved")
  const row = await order(engine, "CD-420516")
  assert.equal(row.calls[0].outcome, "resolved")
  assert.match(row.calls[0].summary ?? "", /stock control/)
  const change = row.proposals.find((proposal) => proposal.kind === "change")
  assert.match(change?.change ?? "", /collected at stock control/)
  assert.equal(row.group, "needs_action", "the key desk waits for the operator's yes")
})

test("each phone takes one live call at a time; the next rings once the first ends", async () => {
  const engine = await phoneEngine({ answererFor: () => "live" })
  await engine.apply({ type: "runCalls" })
  const driver = await engine.phone("driver")
  assert.ok(driver.current)
  assert.ok(driver.queued.length >= 1, "several driver calls are due at load")
  assert.ok(driver.queued.every((call) => call.line === "driver"))
  const [next] = driver.queued
  await assert.rejects(engine.apply({ type: "callEvent", callId: next.id, input: { type: "answer" } }), /queued behind/)

  await engine.apply({ type: "callEvent", callId: driver.current.id, input: { type: "decline" } })
  const after = await engine.phone("driver")
  assert.equal(after.current?.id, next.id, "the next call in the queue rings")
  assert.equal(after.last?.id, driver.current.id)
  assert.equal(after.last?.outcome, "callback")
  const site = await engine.phone("site")
  assert.ok(site.current === null || site.current.line === "site", "site calls ring on the Site phone only")
})

eachStore("an ignored call rings out after the ring timeout and the agent schedules a callback", async (engine) => {
  await engine.apply({ type: "runCalls" })
  const ringing = (await engine.phone("driver")).current
  assert.equal(ringing?.reference, "CD-420806")
  wall.now += 29_000
  await engine.apply({ type: "runCalls" })
  assert.equal((await engine.phone("driver")).current?.state, "ringing", "still ringing before the timeout")
  wall.now += 2_000
  await engine.apply({ type: "runCalls" })
  const call = (await order(engine, "CD-420806")).calls[0]
  assert.deepEqual(call.path, ["ringing", "no_answer", "ended"])
  assert.equal(call.outcome, "callback")
  assert.equal(call.callbackAt, "2026-10-21T09:30:00.000Z", "no answer: the agent calls back 30 minutes later")
  assert.ok(call.cost.ringSeconds >= 30)
}, { calls: () => ({ ...liveOptions(), phoneOpenSince: () => wall.start }) })

const wall = { start: Date.parse("2026-10-21T09:00:00Z"), now: Date.parse("2026-10-21T09:00:00Z") }
function liveOptions(): CallOptions {
  wall.now = wall.start
  return { person: scriptedPerson({}), speech: scriptedSpeech(), answererFor: demoAnswerer(), wallClock: () => wall.now, ringTimeoutMs: 30_000 }
}

test("a call rings out only while its phone page is open, counted from when it opened", async () => {
  let openSince: number | null = null
  const engine = await testEngine({ calls: { ...liveOptions(), phoneOpenSince: () => openSince } })
  await engine.apply({ type: "runCalls" })
  wall.now += 120_000
  await engine.apply({ type: "runCalls" })
  const closed = await engine.phone("driver")
  assert.equal(closed.current?.state, "ringing", "nobody has the phone open: it keeps ringing")
  assert.equal(closed.ringsOutAt, null)

  openSince = wall.now
  const opened = await engine.phone("driver")
  assert.equal(opened.ringsOutAt, new Date(wall.now + 30_000).toISOString())
  wall.now += 31_000
  await engine.apply({ type: "runCalls" })
  assert.equal((await order(engine, "CD-420806")).calls[0].state, "ended")
})

test("a queued call's ring starts when it reaches the phone", async () => {
  const engine = await testEngine({ calls: { ...liveOptions(), answererFor: () => "live" } })
  await engine.apply({ type: "runCalls" })
  const first = (await engine.phone("driver")).current!
  wall.now += 20_000
  await engine.apply({ type: "callEvent", callId: first.id, input: { type: "decline" } })
  const second = await engine.phone("driver")
  assert.notEqual(second.current?.id, first.id)
  assert.equal(second.ringingSince, new Date(wall.now).toISOString())
  wall.now += 20_000
  await engine.apply({ type: "runCalls" })
  assert.equal((await engine.phone("driver")).current?.id, second.current?.id, "20 s on the phone is not yet a ring-out")
  wall.now += 11_000
  await engine.apply({ type: "runCalls" })
  assert.notEqual((await engine.phone("driver")).current?.id, second.current?.id)
})
