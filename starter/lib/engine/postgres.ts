import { and, asc, eq, getTableName, inArray, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type { BriefingItem } from "./briefing"
import type { DistilRun } from "./distil"
import type { EffectEvent } from "./effects"
import type { StoredCallEvent } from "./calls"
import type { InboxEvent } from "./inbox"
import type { LessonAgent, StoredLessonEvent } from "./lessons"
import type { Mistake } from "./mistakes"
import type { StoredProposalEvent } from "./proposals"
import type { StoredPublicationEvent } from "./publishing"
import { briefingItems, callEvents, demoClock, distilRuns, effectEvents, ENGINE_TABLES, inboxEvents, lessonEvents, lessons, mistakes, proposalEvents, publicationEvents } from "./schema"
import type { EngineStore } from "./store"

/** Any drizzle postgres-js client, whatever schema it was built with. */
export type Database = PostgresJsDatabase<any>

const CURRENT = "current"

/** Needs the `cr_` tables to exist: run `npm run db:push` after pulling a ticket that adds one. */
export function createPostgresStore(db: Database): EngineStore {
  return {
    async readClock() {
      const [row] = await db.select().from(demoClock).where(eq(demoClock.id, CURRENT)).limit(1)
      return row ? row.now.toISOString() : null
    },
    async writeClock(now) {
      await db.insert(demoClock).values({ id: CURRENT, now: new Date(now) })
        .onConflictDoUpdate({ target: demoClock.id, set: { now: new Date(now) } })
    },
    async readProposalEvents() {
      const found = await db.select().from(proposalEvents).orderBy(asc(proposalEvents.seq))
      return found.map((row) => ({
        proposalId: row.proposalId, orderId: row.orderId, at: row.at.toISOString(), by: row.by as StoredProposalEvent["by"],
        kind: row.kind as StoredProposalEvent["kind"], text: row.text, data: (row.data ?? null) as StoredProposalEvent["data"],
      }))
    },
    async appendProposalEvents(events) {
      if (!events.length) return
      await db.insert(proposalEvents).values(events.map((event) => ({
        proposalId: event.proposalId, orderId: event.orderId, at: new Date(event.at), by: event.by, kind: event.kind, text: event.text,
        data: (event.data ?? null) as Record<string, unknown> | null,
      })))
    },
    async readEffects() {
      const found = await db.select().from(effectEvents).orderBy(asc(effectEvents.seq))
      return found.map((row) => ({
        ...(row.effect as Record<string, unknown>),
        id: row.id, orderId: row.orderId, type: row.type, at: row.at.toISOString(), by: row.by, source: row.source, text: row.text,
      }) as EffectEvent)
    },
    async appendEffects(events) {
      if (!events.length) return
      await db.insert(effectEvents).values(events.map((event) => {
        const { id, orderId, type, at, by, source, text, ...effect } = event
        return { id, orderId, type, at: new Date(at), by, source, text, effect: effect as Record<string, unknown> }
      }))
    },
    async readCallEvents() {
      const found = await db.select().from(callEvents).orderBy(asc(callEvents.callId), asc(callEvents.seq))
      return found.map((row) => ({
        callId: row.callId, orderId: row.orderId, seq: row.seq, at: row.at.toISOString(), wallAt: row.wallAt.toISOString(),
        by: row.by as StoredCallEvent["by"], kind: row.kind as StoredCallEvent["kind"], text: row.text, data: (row.data ?? null) as StoredCallEvent["data"],
      }))
    },
    async appendCallEvents(events) {
      if (!events.length) return true
      try {
        // One INSERT is atomic: either every step is written or none.
        await db.insert(callEvents).values(events.map((event) => ({
          callId: event.callId, seq: event.seq, orderId: event.orderId, at: new Date(event.at), wallAt: new Date(event.wallAt),
          by: event.by, kind: event.kind, text: event.text, data: (event.data ?? null) as Record<string, unknown> | null,
        })))
        return true
      } catch (error) {
        // 23505 unique_violation: another writer appended this step first.
        const failure = error as { code?: string; cause?: { code?: string } }
        if ((failure.code ?? failure.cause?.code) === "23505") return false
        throw error
      }
    },
    async readBriefing() {
      const rows = await db.select().from(briefingItems)
      return rows.map((row) => ({ ...(row.item as unknown as BriefingItem), read: row.read }))
    },
    async addBriefing(item) {
      const added = await db.insert(briefingItems)
        .values({ id: item.id, kind: item.kind, at: new Date(item.at), item: item as unknown as Record<string, unknown>, read: item.read })
        .onConflictDoNothing({ target: briefingItems.id })
        .returning({ id: briefingItems.id })
      return added.length > 0
    },
    async markBriefingRead(ids) {
      if (ids && !ids.length) return
      await db.update(briefingItems).set({ read: true }).where(ids ? inArray(briefingItems.id, ids) : sql`true`)
    },
    async readPublicationEvents() {
      const found = await db.select().from(publicationEvents).orderBy(asc(publicationEvents.seq))
      return found.map((row) => ({
        orderId: row.orderId, at: row.at.toISOString(), by: row.by as StoredPublicationEvent["by"], kind: row.kind as StoredPublicationEvent["kind"],
        text: row.text, data: (row.data ?? null) as StoredPublicationEvent["data"],
      }))
    },
    async appendPublicationEvents(events) {
      if (!events.length) return
      await db.insert(publicationEvents).values(events.map((event) => ({
        orderId: event.orderId, at: new Date(event.at), by: event.by, kind: event.kind, text: event.text,
        data: (event.data ?? null) as Record<string, unknown> | null,
      })))
    },
    async readInboxEvents() {
      const found = await db.select().from(inboxEvents).orderBy(asc(inboxEvents.seq))
      return found.map((row) => ({
        threadId: row.threadId, orderId: row.orderId, at: row.at.toISOString(), by: row.by as InboxEvent["by"], kind: row.kind as InboxEvent["kind"],
        text: row.text, data: (row.data ?? null) as InboxEvent["data"],
      }))
    },
    async appendInboxEvents(events) {
      if (!events.length) return
      await db.insert(inboxEvents).values(events.map((event) => ({
        threadId: event.threadId, orderId: event.orderId, at: new Date(event.at), by: event.by, kind: event.kind, text: event.text,
        data: (event.data ?? null) as Record<string, unknown> | null,
      })))
    },
    async readLessons() {
      const rows = await db.select().from(lessons)
      return rows.map((row) => ({
        id: row.id, agent: row.agent as LessonAgent, text: row.text, explanation: row.explanation, appliesTo: row.appliesTo,
        sourceMistakeIds: row.sourceMistakeIds, evalBefore: row.evalBefore, evalAfter: row.evalAfter, createdAt: row.createdAt.toISOString(), by: row.by,
      }))
    },
    async addLesson(lesson) {
      const added = await db.insert(lessons).values({ ...lesson, createdAt: new Date(lesson.createdAt) })
        .onConflictDoNothing({ target: lessons.id })
        .returning({ id: lessons.id })
      return added.length > 0
    },
    async readLessonEvents() {
      const found = await db.select().from(lessonEvents).orderBy(asc(lessonEvents.seq))
      return found.map((row) => ({ lessonId: row.lessonId, at: row.at.toISOString(), by: row.by, kind: row.kind as StoredLessonEvent["kind"], text: row.text }))
    },
    async appendLessonEvents(events) {
      if (!events.length) return
      await db.insert(lessonEvents).values(events.map((event) => ({ ...event, at: new Date(event.at) })))
    },
    async reset() {
      const names = ENGINE_TABLES.map((table) => `"${getTableName(table)}"`).join(", ")
      await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY`))
    },
    async readMistakes() {
      const found = await db.select().from(mistakes).orderBy(asc(mistakes.seq))
      return found.map(({ seq: _seq, at, recordedAt, ...row }) => ({
        ...row, at: at.toISOString(), recordedAt: recordedAt.toISOString(),
        agent: row.agent as Mistake["agent"], kind: row.kind as Mistake["kind"], status: row.status as Mistake["status"],
        input: row.input ?? null, agentOutput: row.agentOutput ?? null, editDiff: row.editDiff ?? null, caseFile: (row.caseFile ?? null) as Mistake["caseFile"],
      }))
    },
    async appendMistakes(added) {
      if (!added.length) return
      await db.insert(mistakes).values(added.map((mistake) => ({
        ...mistake, at: new Date(mistake.at), recordedAt: new Date(mistake.recordedAt),
        caseFile: (mistake.caseFile ?? null) as Record<string, unknown> | null,
      }))).onConflictDoNothing({ target: mistakes.id })
    },
    async settleMistake(id, restated) {
      await db.update(mistakes).set(restated).where(and(eq(mistakes.id, id), eq(mistakes.status, "pending")))
    },
    async readDistilRuns() {
      const found = await db.select().from(distilRuns).orderBy(asc(distilRuns.seq))
      return found.map(({ seq: _seq, groupKey, startedAt, finishedAt, ...row }) => ({
        ...row, group: groupKey, startedAt: startedAt.toISOString(), finishedAt: finishedAt?.toISOString() ?? null, outcome: row.outcome as DistilRun["outcome"], gate: row.gate ?? null,
      }))
    },
    async startDistilRun({ group, startedAt, finishedAt, ...run }) {
      await db.insert(distilRuns).values({ ...run, groupKey: group, startedAt: new Date(startedAt), finishedAt: finishedAt ? new Date(finishedAt) : null })
        .onConflictDoNothing({ target: distilRuns.id })
    },
    async finishDistilRun(id, { finishedAt, ...end }) {
      await db.update(distilRuns).set({ ...end, finishedAt: finishedAt ? new Date(finishedAt) : null }).where(eq(distilRuns.id, id))
    },
  }
}
