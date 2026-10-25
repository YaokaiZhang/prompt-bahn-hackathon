// The control room's own tables. ADR 0002: none of them has a foreign key into the
// starter's tables, so reseeding keeps working, and the snapshot is never edited.
// Every table is prefixed `cr_` and listed in ENGINE_TABLES (state, which reset truncates)
// or CACHE_TABLES (content-keyed caches, which reset keeps).

import { bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"

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

/**
 * The Briefing inbox (ticket 13): delivered digests and pushes. `id` makes delivery
 * at-most-once ("digest:12:00", "push:<order id>:<reason>"); `item` is the BriefingItem.
 */
export const briefingItems = pgTable("cr_briefing_items", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  item: jsonb("item").$type<Record<string, unknown>>().notNull(),
  read: boolean("read").notNull().default(false),
})

/** Digest prose the model wrote, keyed by a hash of the digest facts (plus prompt version and model). */
export const digestProse = pgTable("cr_digest_prose", {
  key: text("key").primaryKey(),
  prose: jsonb("prose").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

/**
 * Proposal history (ticket 07): append-only operator decisions on proposals
 * (approved, edited, dismissed, instructed, answered) and engine-made proposals
 * ("proposed", with the draft in `data`). Proposals are folded from these rows plus
 * the current review's findings (lib/engine/proposals.ts).
 */
export const proposalEvents = pgTable("cr_proposal_events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  proposalId: text("proposal_id").notNull(),
  orderId: text("order_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  by: text("by").notNull(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
}, (table) => [index("cr_proposal_events_order_idx").on(table.orderId)])

/**
 * Effect events (ticket 09, ADR 0002): append-only committed changes to an order.
 * The order view, rules and reviewer read the snapshot with these applied
 * (lib/engine/effects.ts). `effect` is the type-specific part (endpoint, window,
 * claim, answer, cost).
 */
export const effectEvents = pgTable("cr_effect_events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  id: text("id").notNull().unique(),
  orderId: text("order_id").notNull(),
  type: text("type").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  by: text("by").notNull(),
  source: text("source").notNull(),
  text: text("text").notNull(),
  effect: jsonb("effect").$type<Record<string, unknown>>().notNull(),
}, (table) => [index("cr_effect_events_order_idx").on(table.orderId)])

/**
 * Calls (ticket 10): append-only events per call; the first ("started") carries the
 * call's header. (call_id, seq) is the key, so two writers cannot take the same step.
 * Calls, call turns, call costs and callbacks are all folded from these rows (lib/engine/calls.ts).
 */
export const callEvents = pgTable("cr_call_events", {
  callId: text("call_id").notNull(),
  seq: integer("seq").notNull(),
  orderId: text("order_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  wallAt: timestamp("wall_at", { withTimezone: true }).notNull(),
  by: text("by").notNull(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
}, (table) => [primaryKey({ columns: [table.callId, table.seq] }), index("cr_call_events_order_idx").on(table.orderId)])

/**
 * Publication events (spec .scratch/publishing, ADR 0003): append-only, per order.
 * `published`, `confirmed` (call results the operator confirmed), `filtered` (the
 * demand filter's result) and `planned` / `plan_failed` (the travel plan) in `data`.
 * Not effect events: publishing changes no record of the order, only its stage.
 */
export const publicationEvents = pgTable("cr_publication_events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  orderId: text("order_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  by: text("by").notNull(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
}, (table) => [index("cr_publication_events_order_idx").on(table.orderId)])

/** Travel plans the model drafted, keyed by a hash of the plan input (plus prompt version and model). */
export const travelPlans = pgTable("cr_travel_plans", {
  key: text("key").primaryKey(),
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
})

/** Every engine state table. Add new tables here so reset clears them. */
export const ENGINE_TABLES = [demoClock, briefingItems, proposalEvents, effectEvents, callEvents, publicationEvents]

/**
 * Caches that reset keeps on purpose (ticket 04). A cached review is keyed by the
 * prompt version, the model and the whole case file (records, `now`, rules, prior
 * state), so after reset a hit is exactly the review a fresh run would produce, and
 * a repeated demo take costs no model calls. Put agent *state* (which review is
 * current, proposals, calls) in ENGINE_TABLES, not here.
 */
export const CACHE_TABLES = [reviewResults, digestProse, travelPlans]
