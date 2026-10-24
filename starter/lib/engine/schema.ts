// The control room's own tables. ADR 0002: none of them has a foreign key into the
// starter's tables, so reseeding keeps working, and the snapshot is never edited.
// Every table is prefixed `cr_` and listed in ENGINE_TABLES (state, which reset truncates)
// or CACHE_TABLES (content-keyed caches, which reset keeps).

import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/** One row (id "current") once the demo clock has moved; no row means the clock is at its start. */
export const demoClock = pgTable("cr_demo_clock", {
  id: text("id").primaryKey(),
  now: timestamp("now", { withTimezone: true }).notNull(),
})

/**
 * Reviewer results (ticket 05), keyed by a hash of the case file plus prompt version and model.
 * `result` is the `Reviewed` value from lib/reviewer/reviewer.ts.
 */
export const reviewResults = pgTable("cr_review_results", {
  key: text("key").primaryKey(),
  orderId: text("order_id").notNull(),
  caseHash: text("case_hash").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [index("cr_review_results_order_idx").on(table.orderId)])

/** Every engine state table. Add new tables here so reset clears them. */
export const ENGINE_TABLES = [demoClock]

/**
 * Caches that reset keeps on purpose (ticket 04). A cached review is keyed by the
 * prompt version, the model and the whole case file (records, `now`, rules, prior
 * state), so after reset a hit is exactly the review a fresh run would produce, and
 * a repeated demo take costs no model calls. Put agent *state* (which review is
 * current, proposals, calls) in ENGINE_TABLES, not here.
 */
export const CACHE_TABLES = [reviewResults]
