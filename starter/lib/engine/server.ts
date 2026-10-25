// The app's engine: the seeded snapshot and the Postgres store. Routes and server
// components call `getEngine()`; nothing else in the app should read our tables.

import "server-only"
import path from "node:path"
import { and, inArray, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { relatedRecords } from "@/lib/schema"
import { openRouterFromEnv } from "@/lib/reviewer/openrouter"
import { createPostgresReviewCache } from "@/lib/reviewer/postgres-cache"
import { reviewSourceFromDatabase } from "@/lib/reviewer/source"
import { createEngine, type Engine } from "./engine"
import { createPostgresStore } from "./postgres"
import { createPostgresPlanCache } from "./plan-cache"
import { createPostgresProseCache } from "./prose-cache"
import { demoAnswerer, RING_TIMEOUT_MS, type PhonePersona } from "./phone"
import { DEMO_SCRIPTS, modelCallee, simulatedPerson } from "./simulated-person"
import { createDiskAudioStore, openRouterSpeechFromEnv, type AudioStore } from "./speech"
import { createVoiceAgent, type VoiceAgent } from "./voice-agent"
import { openRouterTranscriberFromEnv, openRouterVoiceFromEnv } from "./voice-openrouter"
import type { ModelGateway } from "@/lib/reviewer/gateway"
import type { SuggestOptions } from "./inbox-agent"
import { createPostgresSuggestionCache } from "./suggestion-cache"

// The snapshot is read once per server process (kept across dev reloads).
// Restart the server after reseeding. Reviews are read from cr_review_results on
// each state (the seed sweep, `npm run review:sweep`, writes them from its own process).
const cache = globalThis as unknown as {
  controlRoomEngine?: Promise<Engine>; controlRoomAudio?: AudioStore; controlRoomPump?: ReturnType<typeof setInterval>
  controlRoomPhones?: Map<PhonePersona, { since: number; seen: number }>
  controlRoomPublishing?: ReturnType<typeof setInterval>
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

/**
 * Tier 2 (ticket 12): the audio model answers live calls aloud, the ear transcribes,
 * Haiku (the reviewer's gateway) writes the opener and checks each turn; simulated
 * calls skip the audio and talk in text. Needs the key; TIER2_AUDIO_MODEL=off runs the
 * fallback (ear, Haiku, text to speech) only.
 */
function voiceAgent(gateway: ModelGateway | null): VoiceAgent | null {
  const ear = openRouterTranscriberFromEnv()
  if (!gateway || !ear) return null
  return createVoiceAgent({ voice: openRouterVoiceFromEnv(getAudioStore()), ear, checker: gateway })
}

/** How often the publishing loop runs (ms); PUBLISH_PUMP_MS=0 turns it off. */
const PUBLISH_MS = Number(process.env.PUBLISH_PUMP_MS ?? 3000)

/**
 * The publishing loop (spec .scratch/publishing): the agent publishes reviewed Normal
 * orders, filters every order on the market and drafts one travel plan per tick, on its
 * own interval so a slow plan never holds up the call pump.
 */
function startPublishing(engine: Engine): void {
  if (!PUBLISH_MS || cache.controlRoomPublishing) return
  let busy = false
  cache.controlRoomPublishing = setInterval(() => {
    if (busy) return
    busy = true
    engine.apply({ type: "runPublishing", plans: 1 })
      .catch((error) => console.error("publishing:", error instanceof Error ? error.message : error))
      .finally(() => { busy = false })
  }, PUBLISH_MS)
  cache.controlRoomPublishing.unref?.()
}

/** Ferry terminals and city-to-terminal road estimates: reference rows (no order id) the travel planner reads. */
async function travelReference() {
  const rows = await db.select().from(relatedRecords).where(and(isNull(relatedRecords.orderId), inArray(relatedRecords.collection, ["ferry_terminals", "terminal_road_estimates"])))
  return {
    terminals: rows.filter((row) => row.collection === "ferry_terminals").map((row) => ({ id: row.id, ...row.details })),
    roadEstimates: rows.filter((row) => row.collection === "terminal_road_estimates").map((row) => ({ id: row.id, ...row.details })),
  }
}

export function getEngine(): Promise<Engine> {
  cache.controlRoomEngine ??= Promise.all([reviewSourceFromDatabase(db), travelReference()])
    .then(([source, reference]) => {
      const gateway = openRouterFromEnv()
      const engine = createEngine({
        snapshot: source.snapshot,
        store: createPostgresStore(db),
        reviews: { gateway, cache: createPostgresReviewCache(db), inboxMessages: source.inboxMessages },
        // Digest prose (ticket 13): the same gateway, low effort, template text after about 5 s.
        briefing: { gateway, cache: createPostgresProseCache(db) },
        // Calls (ticket 10): background calls are answered by the simulated person; demo
        // cases and "ring live" calls ring on the Site/Driver phone page (ticket 11).
        // At tier 2 a model plays the background callee in text (ticket 12), so a
        // simulated escalation is talked through rather than handed over at once.
        calls: {
          person: simulatedPerson(DEMO_SCRIPTS, gateway ? modelCallee(gateway) : undefined), speech: openRouterSpeechFromEnv(getAudioStore()), pace: 1,
          ...(LIVE_DEMO ? { answererFor: demoAnswerer() } : {}),
          phoneOpenSince, ringTimeoutMs: RING_TIMEOUT, voice: voiceAgent(gateway),
        },
        // Travel plans (spec .scratch/publishing): the same gateway; template plans without a key.
        travel: { gateway, cache: createPostgresPlanCache(db), reference },
      })
      startPump(engine)
      startPublishing(engine)
      return engine
    })
    .catch((error) => { cache.controlRoomEngine = undefined; throw error })
  return cache.controlRoomEngine
}

/** The inbox agent's model and cache (inbox-agent.ts): the reviewer's gateway; template suggestions without a key. */
export function inboxAgentOptions(): SuggestOptions {
  return { gateway: openRouterFromEnv(), cache: createPostgresSuggestionCache(db) }
}
