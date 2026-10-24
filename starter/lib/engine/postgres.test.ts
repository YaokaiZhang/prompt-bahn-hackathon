// The app runs the engine on the seeded database. These tests need TEST_DATABASE_URL
// (a seeded database of its own, schema pushed) and are skipped without it.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { sql } from "drizzle-orm"
import type { Bundle } from "@/lib/present/bundle"
import { createEngine } from "./engine"
import { createPostgresStore } from "./postgres"
import { snapshotFromDatabase } from "./snapshot"
import { testDatabase, testSnapshot } from "./testing"

const skip = process.env.TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL"

/** What a reader of the bundle sees, without the shared lookup maps. */
function summary(bundle: Bundle) {
  return {
    order: bundle.order,
    customer: bundle.customer,
    items: bundle.items,
    alerts: bundle.alerts,
    conversations: bundle.conversations.map((thread) => thread.id),
    messages: bundle.messages.map((message) => message.id),
    events: bundle.events.map((event) => event.id).sort(),
    related: Object.fromEntries(Object.entries(bundle.related).sort(([a], [b]) => a.localeCompare(b))
      .map(([collection, rows]) => [collection, (rows ?? []).map((row) => row.id).sort()])),
    inbox: bundle.inboxThreads.map((thread) => thread.id),
    linked: bundle.bundleOrderRefs,
  }
}

test("the seeded database gives the same bundles as the dataset files", { skip }, async () => {
  const db = testDatabase()!
  const [fromDb, fromFiles] = await Promise.all([snapshotFromDatabase(db), testSnapshot()])
  assert.equal(fromDb.snapshotAt, fromFiles.snapshotAt)
  assert.deepEqual(fromDb.bundles.map(summary), fromFiles.bundles.map(summary))
})

test("reset empties our tables and leaves the snapshot untouched", { skip }, async () => {
  const db = testDatabase()!
  const engine = createEngine({ snapshot: await snapshotFromDatabase(db), store: createPostgresStore(db) })
  await engine.apply({ type: "advanceClock", minutes: 30 })
  await engine.apply({ type: "reset" })
  assert.equal(await engine.clock(), "2026-10-21T09:00:00.000Z")
  const after = await snapshotFromDatabase(db)
  assert.equal(after.bundles.length, 100)
  assert.deepEqual(after.bundles.map(summary), (await testSnapshot()).bundles.map(summary))
})

test("our tables hold no foreign keys, and the starter's seed runs beside them without clearing them", { skip }, async () => {
  const db = testDatabase()!
  const foreignKeys = await db.execute(sql`
    SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.contype = 'f' AND t.relname LIKE 'cr\_%'`)
  assert.equal(foreignKeys.length, 0)

  const store = createPostgresStore(db)
  await store.reset()
  await store.writeClock("2026-10-21T11:00:00.000Z")
  const seed = spawnSync("npx", ["tsx", "scripts/seed.ts"], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, encoding: "utf8",
  })
  assert.equal(seed.status, 0, seed.stderr)
  assert.equal(await store.readClock(), "2026-10-21T11:00:00.000Z")
  await store.reset()
})
