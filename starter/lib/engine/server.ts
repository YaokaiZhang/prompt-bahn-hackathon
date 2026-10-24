// The app's engine: the seeded snapshot and the Postgres store. Routes and server
// components call `getEngine()`; nothing else in the app should read our tables.

import "server-only"
import path from "node:path"
import { db } from "@/lib/db"
import { openRouterFromEnv } from "@/lib/reviewer/openrouter"
import { createPostgresReviewCache } from "@/lib/reviewer/postgres-cache"
import { reviewSourceFromDatabase } from "@/lib/reviewer/source"
import { createEngine, type Engine } from "./engine"
import { createPostgresStore } from "./postgres"
import { createPostgresProseCache } from "./prose-cache"
import { simulatedPerson } from "./simulated-person"
import { createDiskAudioStore, openRouterSpeechFromEnv, type AudioStore } from "./speech"

// The snapshot is read once per server process (kept across dev reloads).
// Restart the server after reseeding. Reviews are read from cr_review_results on
// each state (the seed sweep, `npm run review:sweep`, writes them from its own process).
const cache = globalThis as unknown as { controlRoomEngine?: Promise<Engine>; controlRoomAudio?: AudioStore; controlRoomPump?: ReturnType<typeof setInterval> }

/**
 * Cached tier-1 speech, as files (AUDIO_CACHE_DIR, default `.cache/tts` in the app
 * directory). Another `AudioStore` (S3, Postgres) can replace it without touching calls.
 */
export function getAudioStore(): AudioStore {
  cache.controlRoomAudio ??= createDiskAudioStore(process.env.AUDIO_CACHE_DIR || path.join(process.cwd(), ".cache", "tts"))
  return cache.controlRoomAudio
}

/** How often the call pump takes one step on every background call (ms); CALL_PUMP_MS=0 turns it off. */
const PUMP_MS = Number(process.env.CALL_PUMP_MS ?? 1000)

/**
 * The call pump: background calls run on their own in the server process, one
 * exchange per call per tick, paced like a real phone so the order page can show
 * the live transcript. It also starts the calls the rules and proposals plan.
 */
function startPump(engine: Engine): void {
  if (!PUMP_MS || cache.controlRoomPump) return
  let busy = false
  cache.controlRoomPump = setInterval(() => {
    if (busy) return
    busy = true
    engine.apply({ type: "runCalls", steps: 1 })
      .catch((error) => console.error("call pump:", error instanceof Error ? error.message : error))
      .finally(() => { busy = false })
  }, PUMP_MS)
  cache.controlRoomPump.unref?.()
}

export function getEngine(): Promise<Engine> {
  cache.controlRoomEngine ??= reviewSourceFromDatabase(db)
    .then((source) => {
      const gateway = openRouterFromEnv()
      const engine = createEngine({
        snapshot: source.snapshot,
        store: createPostgresStore(db),
        reviews: { gateway, cache: createPostgresReviewCache(db), inboxMessages: source.inboxMessages },
        // Digest prose (ticket 13): the same gateway, low effort, template text after about 5 s.
        briefing: { gateway, cache: createPostgresProseCache(db) },
        // Calls (ticket 10): every call is answered by the simulated person for now
        // (ticket 11 routes demo cases and "ring live" calls to the phone page).
        calls: { person: simulatedPerson(), speech: openRouterSpeechFromEnv(getAudioStore()), pace: 1 },
      })
      startPump(engine)
      return engine
    })
    .catch((error) => { cache.controlRoomEngine = undefined; throw error })
  return cache.controlRoomEngine
}
