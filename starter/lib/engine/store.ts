// The store port: where the engine keeps its own state. The app uses the Postgres
// store; tests use the in-memory store. Both must behave the same, so every engine
// test can run against either (see `testing.ts`).
//
// Extend by adding a method here, then implementing it in `memory.ts` and
// `postgres.ts` (with a `cr_` table in `schema.ts`). Times cross the port as ISO strings.

import type { BriefingItem } from "./briefing"
import type { StoredProposalEvent } from "./proposals"

export interface EngineStore {
  /** The demo clock, or null when it has not moved from its start. */
  readClock(): Promise<string | null>
  writeClock(now: string): Promise<void>
  /** Every Briefing item delivered so far (ticket 13), in no particular order. */
  readBriefing(): Promise<BriefingItem[]>
  /** Stores an item unless one with its id exists; true when it was added (at most once per id). */
  addBriefing(item: BriefingItem): Promise<boolean>
  /** Marks items read (all unread ones when `ids` is absent). */
  markBriefingRead(ids?: string[]): Promise<void>
  /** Every stored proposal event (operator decisions, engine-made proposals), in the order they were appended. */
  readProposalEvents(): Promise<StoredProposalEvent[]>
  /** Appends events in one go (a batch approval is all or nothing). */
  appendProposalEvents(events: StoredProposalEvent[]): Promise<void>
  /** Empties every engine table. The snapshot is never touched. */
  reset(): Promise<void>
}
