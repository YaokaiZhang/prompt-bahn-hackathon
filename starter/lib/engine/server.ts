// The app's engine: the seeded snapshot and the Postgres store. Routes and server
// components call `getEngine()`; nothing else in the app should read our tables.

import "server-only"
import { db } from "@/lib/db"
import { openRouterFromEnv } from "@/lib/reviewer/openrouter"
import { createPostgresReviewCache } from "@/lib/reviewer/postgres-cache"
import { reviewSourceFromDatabase } from "@/lib/reviewer/source"
import { createEngine, type Engine } from "./engine"
import { createPostgresStore } from "./postgres"
import { createPostgresProseCache } from "./prose-cache"

// The snapshot is read once per server process (kept across dev reloads).
// Restart the server after reseeding. Reviews are read from cr_review_results on
// each state (the seed sweep, `npm run review:sweep`, writes them from its own process).
const cache = globalThis as unknown as { controlRoomEngine?: Promise<Engine> }

export function getEngine(): Promise<Engine> {
  cache.controlRoomEngine ??= reviewSourceFromDatabase(db)
    .then((source) => {
      const gateway = openRouterFromEnv()
      return createEngine({
        snapshot: source.snapshot,
        store: createPostgresStore(db),
        reviews: { gateway, cache: createPostgresReviewCache(db), inboxMessages: source.inboxMessages },
        // Digest prose (ticket 13): the same gateway, low effort, template text after about 5 s.
        briefing: { gateway, cache: createPostgresProseCache(db) },
      })
    })
    .catch((error) => { cache.controlRoomEngine = undefined; throw error })
  return cache.controlRoomEngine
}
