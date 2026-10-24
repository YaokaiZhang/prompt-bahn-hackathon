// Runs the reviewer on one order and prints its findings and cost.
//
//   npm run review -- CD-420516            (or ord-00516)
//   npm run review -- CD-420516 --json     the raw result
//   npm run review -- CD-420516 --no-cache skip the cr_review_results cache
//   npm run review -- CD-420516 --now 2026-10-21T10:00:00Z
//
// Reads the dataset files (DATASET_DIR honoured). Uses OPENROUTER_API_KEY; without it
// the order is reported "not reviewed yet" (unless the cache already has it).
// Rule results are not wired in yet (ticket 06 passes them in).

import "dotenv/config"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { createPostgresStore } from "../lib/engine/postgres"
import { createMemoryReviewCache, type ReviewCache } from "../lib/reviewer/cache"
import { openRouterFromEnv } from "../lib/reviewer/openrouter"
import { createPostgresReviewCache } from "../lib/reviewer/postgres-cache"
import { formatReview } from "../lib/reviewer/report"
import { createReviewer } from "../lib/reviewer/reviewer"
import { reviewSourceFromFiles } from "../lib/reviewer/source"

function flag(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

async function main(): Promise<void> {
  const order = process.argv.slice(2).find((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--now")
  if (!order) {
    console.error("Usage: npm run review -- <order reference or id> [--json] [--no-cache] [--now ISO]")
    process.exit(2)
  }
  const source = await reviewSourceFromFiles()

  let cache: ReviewCache = createMemoryReviewCache()
  let now = flag("--now") ?? source.snapshot.snapshotAt
  let close = async () => {}
  const url = process.env.DATABASE_URL
  if (url && !process.argv.includes("--no-cache")) {
    const client = postgres(url, { max: 1, onnotice: () => {} })
    const db = drizzle(client)
    close = () => client.end()
    try {
      if (!flag("--now")) now = (await createPostgresStore(db).readClock()) ?? now
      cache = createPostgresReviewCache(db)
      await cache.get("probe")
    } catch (error) {
      console.error(`Review cache unavailable (${(error as Error).message}); run \`npx drizzle-kit push\`. Using memory.`)
      cache = createMemoryReviewCache()
    }
  }

  const reviewer = createReviewer({ gateway: openRouterFromEnv(), source, cache })
  try {
    const result = await reviewer.review(order, { now })
    console.log(process.argv.includes("--json") ? JSON.stringify(result, null, 2) : formatReview(result))
  } finally {
    await close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
