import { asc, eq, getTableName, inArray, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type { BriefingItem } from "./briefing"
import type { StoredProposalEvent } from "./proposals"
import { briefingItems, demoClock, ENGINE_TABLES, proposalEvents } from "./schema"
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
    async reset() {
      const names = ENGINE_TABLES.map((table) => `"${getTableName(table)}"`).join(", ")
      await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY`))
    },
  }
}
