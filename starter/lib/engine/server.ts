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
import { demoAnswerer, RING_TIMEOUT_MS, type PhonePersona } from "./phone"
import { simulatedPerson } from "./simulated-person"
import { createDiskAudioStore, openRouterSpeechFromEnv, type AudioStore } from "./speech"

// The snapshot is read once per server process (kept across dev reloads).
// Restart the server after reseeding. Reviews are read from cr_review_results on
// each state (the seed sweep, `npm run review:sweep`, writes them from its own process).
const cache = globalThis as unknown as {
  controlRoomEngine?: Promise<Engine>; controlRoomAudio?: AudioStore; controlRoomPump?: ReturnType<typeof setInterval>
  controlRoomPhones?: Map<PhonePersona, { since: number; seen: number }>
}

/** A phone page counts as open while it polled within this many ms. */
const PHONE_SEEN_MS = 8_000

function phones(): Map<PhonePersona, { since: number; seen: number }> {
  cache.controlRoomPhones ??= new Map()
  return cache.controlRoomPhones
}

/** The phone page for `persona` is open (it polls `/api/phone`). Live calls ring out only on an open phone. */
export function markPhoneOpen(persona: PhonePersona): void {
  const now = Date.now()
  const known = phones().get(persona)
  phones().set(persona, { since: known && now - known.seen < PHONE_SEEN_MS ? known.since : now, seen: now })
}

function phoneOpenSince(persona: PhonePersona): number | null {
  const known = phones().get(persona)
  return known && Date.now() - known.seen < PHONE_SEEN_MS ? known.since : null
}

/** Demo cases ring live on the phone page unless LIVE_DEMO_CALLS=0 (then the simulated person runs the scripts alone). */
const LIVE_DEMO = process.env.LIVE_DEMO_CALLS !== "0"
const RING_TIMEOUT = Number(process.env.PHONE_RING_TIMEOUT_MS) || RING_TIMEOUT_MS

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
        // Calls (ticket 10): background calls are answered by the simulated person; demo
        // cases and "ring live" calls ring on the Site/Driver phone page (ticket 11).
        calls: {
          person: simulatedPerson(), speech: openRouterSpeechFromEnv(getAudioStore()), pace: 1,
          ...(LIVE_DEMO ? { answererFor: demoAnswerer() } : {}),
          phoneOpenSince, ringTimeoutMs: RING_TIMEOUT,
        },
      })
      startPump(engine)
      return engine
    })
    .catch((error) => { cache.controlRoomEngine = undefined; throw error })
  return cache.controlRoomEngine
}
