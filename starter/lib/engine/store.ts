// The store port: where the engine keeps its own state. The app uses the Postgres
// store; tests use the in-memory store. Both must behave the same, so every engine
// test can run against either (see `testing.ts`).
//
// Extend by adding a method here, then implementing it in `memory.ts` and
// `postgres.ts` (with a `cr_` table in `schema.ts`). Times cross the port as ISO strings.

import type { BriefingItem } from "./briefing"
import type { EffectEvent } from "./effects"
import type { StoredCallEvent } from "./calls"
import type { InboxEvent } from "./inbox"
import type { Mistake, Restated } from "./mistakes"
import type { StoredLesson, StoredLessonEvent } from "./lessons"
import type { StoredProposalEvent } from "./proposals"
import type { StoredPublicationEvent } from "./publishing"

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
  /** Every effect event (ticket 09), in the order they were appended. Append-only: never updated or deleted (except by reset). */
  readEffects(): Promise<EffectEvent[]>
  /** Appends effect events in one go. */
  appendEffects(events: EffectEvent[]): Promise<void>
  /** Every stored call event (ticket 10), oldest first within each call. */
  readCallEvents(): Promise<StoredCallEvent[]>
  /**
   * Appends events of one call in one go. False (and nothing written) when any
   * (callId, seq) exists already: another writer took that step first.
   */
  appendCallEvents(events: StoredCallEvent[]): Promise<boolean>
  /** Every publication event (publishing.ts), in the order they were appended. */
  readPublicationEvents(): Promise<StoredPublicationEvent[]>
  /** Appends publication events in one go. */
  appendPublicationEvents(events: StoredPublicationEvent[]): Promise<void>
  /** Every support inbox event (inbox.ts), in the order they were appended. */
  readInboxEvents(): Promise<InboxEvent[]>
  /** Appends inbox events in one go. */
  appendInboxEvents(events: InboxEvent[]): Promise<void>
  /** Every lesson candidate ever added (lessons.ts), in no particular order. Reset keeps them. */
  readLessons(): Promise<StoredLesson[]>
  /** Stores a lesson unless one with its id exists; true when it was added. */
  addLesson(lesson: StoredLesson): Promise<boolean>
  /** The operator's decisions on lessons, in the order they were appended. Reset keeps them. */
  readLessonEvents(): Promise<StoredLessonEvent[]>
  appendLessonEvents(events: StoredLessonEvent[]): Promise<void>
  /** Empties every engine table. The snapshot and what the agents learned are never touched. */
  reset(): Promise<void>
  /** Every mistake (mistakes.ts), in the order they were recorded. Kept across reset. */
  readMistakes(): Promise<Mistake[]>
  /** Stores mistakes; one whose id exists already is skipped. */
  appendMistakes(mistakes: Mistake[]): Promise<void>
  /** Writes a pending mistake's restatement and status, once (a settled mistake is left as it is). */
  settleMistake(id: string, restated: Restated): Promise<void>
}
