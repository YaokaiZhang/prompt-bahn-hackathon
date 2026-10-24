import { eq, getTableName, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { demoClock, ENGINE_TABLES } from "./schema"
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
    async reset() {
      const names = ENGINE_TABLES.map((table) => `"${getTableName(table)}"`).join(", ")
      await db.execute(sql.raw(`TRUNCATE ${names}`))
    },
  }
}
