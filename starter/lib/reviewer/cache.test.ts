// The review cache behaves the same in memory and in Postgres. The Postgres run
// needs TEST_DATABASE_URL (schema pushed) and is skipped without it.

import assert from "node:assert/strict"
import { test } from "node:test"
import { createPostgresStore } from "@/lib/engine/postgres"
import { reviewResults } from "@/lib/engine/schema"
import { testDatabase } from "@/lib/engine/testing"
import { createMemoryReviewCache, type ReviewCache } from "./cache"
import { createPostgresReviewCache } from "./postgres-cache"
import type { Reviewed } from "./reviewer"

const sample: Reviewed = {
  status: "reviewed", orderId: "ord-00516", reference: "CD-420516", hash: "abc", summary: "Ask the site.",
  findings: [{
    title: "Key holder unknown",
    conflict: [{ recordId: "a", field: "body", quote: "x" }, { recordId: "b", field: "body", quote: "y" }],
    ask: { role: "site", contactType: "third_party_site", contactRecordId: "ep", contactQuote: "site", name: "Site" },
    whoPays: "cus-005", policyRow: "site-routine", question: "Who?", why: "Because.", repaired: false,
  }],
  dropped: [], recordsRead: 35, toolCalls: 0, refusedToolCalls: 0, turns: 1, cost: 0.02,
  usage: { promptTokens: 1, completionTokens: 2, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 0.02 },
  model: "m", reviewedAt: "2026-10-24T10:00:00.000Z", cached: false,
}

const stores: { name: string; make: () => Promise<ReviewCache> | null }[] = [
  { name: "memory", make: async () => createMemoryReviewCache() },
  {
    name: "postgres",
    make: () => {
      const db = testDatabase()
      if (!db) return null
      return (async () => {
        await db.delete(reviewResults)
        return createPostgresReviewCache(db)
      })()
    },
  },
]

for (const store of stores) {
  const skip = store.name === "postgres" && !process.env.TEST_DATABASE_URL ? "set TEST_DATABASE_URL" : false
  test(`a stored review comes back by its key, and an unknown key misses [${store.name}]`, { skip }, async () => {
    const cache = await store.make()!
    assert.equal(await cache.get("k1"), null)
    await cache.put("k1", sample)
    assert.deepEqual(await cache.get("k1"), sample)
    await cache.put("k1", { ...sample, summary: "Again." })
    assert.equal((await cache.get("k1"))?.summary, "Again.")
    assert.equal(await cache.get("k2"), null)
  })
}

test("engine reset keeps cached reviews: they are keyed by what they read [postgres]", { skip: process.env.TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL" }, async () => {
  const db = testDatabase()!
  const cache = createPostgresReviewCache(db)
  await cache.put("k1", sample)
  await createPostgresStore(db).reset()
  assert.deepEqual(await cache.get("k1"), sample)
})
