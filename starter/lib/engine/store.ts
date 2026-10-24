// The store port: where the engine keeps its own state. The app uses the Postgres
// store; tests use the in-memory store. Both must behave the same, so every engine
// test can run against either (see `testing.ts`).
//
// Extend by adding a method here, then implementing it in `memory.ts` and
// `postgres.ts` (with a `cr_` table in `schema.ts`). Times cross the port as ISO strings.

export interface EngineStore {
  /** The demo clock, or null when it has not moved from its start. */
  readClock(): Promise<string | null>
  writeClock(now: string): Promise<void>
  /** Empties every engine table. The snapshot is never touched. */
  reset(): Promise<void>
}
