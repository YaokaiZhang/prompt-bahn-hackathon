import assert from "node:assert/strict"
import { test } from "node:test"
import { eachStore, testEngine } from "./testing"

const START = "2026-10-21T09:00:00.000Z"

test("the engine loads all 100 orders and starts the demo clock at the snapshot", async () => {
  const engine = await testEngine()
  const state = await engine.state()
  assert.equal(state.orders.length, 100)
  assert.equal(state.now, START)
})

eachStore("the demo clock moves forward and stays moved", async (engine) => {
  const moved = await engine.apply({ type: "advanceClock", minutes: 15 })
  assert.equal(moved.now, "2026-10-21T09:15:00.000Z")
  await engine.apply({ type: "advanceClock", minutes: 45 })
  assert.equal((await engine.state()).now, "2026-10-21T10:00:00.000Z")
})

eachStore("the clock never moves backwards", async (engine) => {
  await assert.rejects(engine.apply({ type: "advanceClock", minutes: -5 }))
  assert.equal((await engine.state()).now, START)
})

eachStore("reset returns the clock to the snapshot and leaves the orders as they were", async (engine) => {
  const before = await engine.state()
  await engine.apply({ type: "advanceClock", minutes: 90 })
  const after = await engine.apply({ type: "reset" })
  assert.equal(after.now, START)
  assert.deepEqual(after.orders, before.orders)
})

test("state can be read as of a given time without moving the clock", async () => {
  const engine = await testEngine()
  assert.equal((await engine.state("2026-10-21T12:00:00Z")).now, "2026-10-21T12:00:00.000Z")
  assert.equal((await engine.state()).now, START)
})
