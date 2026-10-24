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
import type { ReviewCache } from "@/lib/reviewer/cache"
import { loadFixtures, SCENARIO_FIXTURE_DIR } from "@/lib/reviewer/fixtures"
import { GatewayError, NO_USAGE, type ChatRequest, type ModelGateway } from "@/lib/reviewer/gateway"
import { createScriptedGateway } from "@/lib/reviewer/scripted"
import { testReviewSource } from "@/lib/reviewer/testing"
import type { ProseOptions } from "./digest-prose"
import { createEngine, type Engine, type Snapshot } from "./engine"
import { createMemoryStore } from "./memory"
import { createPostgresStore, type Database } from "./postgres"
import type { EngineStore } from "./store"

/** The real dataset, read once per test process. */
export async function testSnapshot(): Promise<Snapshot> {
  return (await testReviewSource()).snapshot
}

export type TestEngineOptions = {
  store?: EngineStore
  /** The reviewer's model: absent means no key ("not reviewed yet"). Use `testGateway()`. */
  gateway?: ModelGateway | null
  reviewCache?: ReviewCache
  /** The digest prose's gateway, cache and timeout. Absent: template text. Use `proseGateway()`. */
  briefing?: ProseOptions
}

export async function testEngine(options: TestEngineOptions = {}): Promise<Engine> {
  const source = await testReviewSource()
  return createEngine({
    snapshot: source.snapshot,
    store: options.store ?? createMemoryStore(),
    reviews: { gateway: options.gateway ?? null, cache: options.reviewCache, inboxMessages: source.inboxMessages },
    briefing: options.briefing,
  })
}

export type CountingGateway = ModelGateway & { readonly calls: ChatRequest[] }

/**
 * The scripted reviewer for engine tests: the permanent hand-written scenarios
 * (CD-420089, 399, 437, 458, 516) and "nothing to ask" for every other order.
 */
export async function testGateway(): Promise<CountingGateway> {
  const scripted = createScriptedGateway(await loadFixtures(SCENARIO_FIXTURE_DIR))
  const known = new Set((await loadFixtures(SCENARIO_FIXTURE_DIR)).map((fixture) => fixture.reference))
  const calls: ChatRequest[] = []
  return {
    calls,
    async chat(request) {
      calls.push(request)
      if (known.has(request.subject)) return scripted.chat(request)
      const args = JSON.stringify({ summary: `Nothing to ask on ${request.subject}.`, findings: [] })
      return {
        model: "scripted",
        finishReason: "tool_calls",
        usage: { ...NO_USAGE, promptTokens: 9000, completionTokens: 40, cost: 0.002 },
        message: { role: "assistant", content: null, tool_calls: [{ id: `call_${request.subject}`, type: "function", function: { name: "submit_findings", arguments: args } }] },
      }
    },
  }
}

/**
 * A scripted digest writer: answers every call with `reply` (an opener and a first
 * move, or raw content) after `delayMs`. `.calls` lists the requests.
 */
export function proseGateway(reply: { opener: string; firstMove: string } | string, delayMs = 0): CountingGateway {
  const calls: ChatRequest[] = []
  return {
    calls,
    async chat(request) {
      calls.push(request)
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      const content = typeof reply === "string" ? reply : JSON.stringify(reply)
      return { model: "scripted", finishReason: "stop", usage: { ...NO_USAGE, promptTokens: 2000, completionTokens: 120, cost: 0.001 }, message: { role: "assistant", content } }
    },
  }
}

/** A model that is unreachable: every call fails, as behind a blocking proxy. */
export function failingGateway(message: string): CountingGateway {
  const calls: ChatRequest[] = []
  return {
    calls,
    async chat(request) {
      calls.push(request)
      throw new GatewayError(`OpenRouter request failed: ${message}`)
    },
  }
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
