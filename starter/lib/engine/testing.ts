// Test setup for engine tests: the real dataset files, the clock at the snapshot
// (2026-10-21T09:00Z), and a store. `eachStore` runs one test against the in-memory
// store and, when TEST_DATABASE_URL is set, against the Postgres store too.
//
// TEST_DATABASE_URL must point at a database of its own (tests reset its cr_ tables)
// with the schema pushed: `DATABASE_URL=$TEST_DATABASE_URL npx drizzle-kit push --force`.

import "dotenv/config"
import { after, test } from "node:test"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { createEngine, type Engine, type Snapshot } from "./engine"
import { createMemoryStore } from "./memory"
import { createPostgresStore, type Database } from "./postgres"
import { snapshotFromFiles } from "./snapshot"
import type { EngineStore } from "./store"

let snapshot: Promise<Snapshot> | null = null

/** The real dataset, read once per test process. */
export function testSnapshot(): Promise<Snapshot> {
  snapshot ??= snapshotFromFiles()
  return snapshot
}

export async function testEngine(options: { store?: EngineStore } = {}): Promise<Engine> {
  return createEngine({ snapshot: await testSnapshot(), store: options.store ?? createMemoryStore() })
}

let database: { db: Database; close: () => Promise<void> } | null = null

/** The test database, or null when TEST_DATABASE_URL is not set. Closed after the test file. */
export function testDatabase(): Database | null {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return null
  if (!database) {
    const client = postgres(url, { max: 2, onnotice: () => {} })
    database = { db: drizzle(client), close: () => client.end() }
    after(async () => { await database?.close(); database = null })
  }
  return database.db
}

type StoreCase = { name: string; make: () => Promise<EngineStore> | null }

const STORES: StoreCase[] = [
  { name: "memory", make: async () => createMemoryStore() },
  {
    name: "postgres",
    make: () => {
      const db = testDatabase()
      if (!db) return null
      return (async () => {
        const store = createPostgresStore(db)
        await store.reset()
        return store
      })()
    },
  },
]

/** Registers `name` once per store. The Postgres run is skipped without TEST_DATABASE_URL. */
export function eachStore(name: string, body: (engine: Engine) => Promise<void>): void {
  for (const store of STORES) {
    test(`${name} [${store.name}]`, { skip: store.name === "postgres" && !process.env.TEST_DATABASE_URL ? "set TEST_DATABASE_URL" : false }, async () => {
      const made = store.make()
      if (!made) return
      await body(await testEngine({ store: await made }))
    })
  }
}
