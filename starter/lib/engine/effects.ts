// Effect events (ticket 09, ADR 0002): every committed change to an order is an
// append-only effect event in our own tables. The snapshot rows are never edited;
// `applyEffects` lays the events over a bundle, and the order view, the rules and
// the reviewer all read that overlaid bundle.
//
// Eight types (spec "Our own tables"):
//   contact_confirmed          endpoint contact_status / last_confirmed_source / last_confirmed_at
//   contact_changed            endpoint contact name, handle and role
//   window_changed             the selected pickup slot or the delivery promise (start/end)
//   call_result_recorded       an attributed claim; the source is the call
//   eta_reported               a new ETA as a time, stated by the driver on a call; it supersedes
//                              the tracking observation it replaces (never the delivery promise, ADR 0001)
//   customer_answer_recorded   an attributed claim; the source is the operator's record of the customer
//   operator_answer_recorded   an attributed note by the operator
//   cost_approved              an expense approved, or a new cost line
//
// Versioning: an effect event writes a new VERSION of the fact it settles (`fact`:
// "who may sign at delivery", an endpoint's contact, a window). Version 1 is what the
// snapshot says; each effect on the same fact adds one. The event names the records it
// replaces (`supersedes`: the older statements on that point, by the party who now
// answered). The overlay shows the current version as the live value and keeps the
// older statements as superseded history: still there, still citable, but marked
// "superseded by <event>". A new version supersedes only what it actually answers, so
// a record by anyone else that disagrees with it is still a conflict.
//
// Every event is also listed as a record of its own (`related.effect_events`): an
// attributed, timestamped claim the reviewer can read and cite.
//
// Pure: bundle and events in, bundle out.

import { createHash } from "node:crypto"
import { rows, str, type Bundle, type RelatedRow } from "@/lib/present/bundle"
import type { Row } from "@/lib/present/types"
import type { Actor } from "./proposals"

export type EffectType =
  | "contact_confirmed" | "contact_changed" | "window_changed"
  | "call_result_recorded" | "eta_reported" | "customer_answer_recorded" | "operator_answer_recorded" | "cost_approved"

export const EFFECT_TYPES: EffectType[] = [
  "contact_confirmed", "contact_changed", "window_changed", "call_result_recorded", "eta_reported", "customer_answer_recorded", "operator_answer_recorded", "cost_approved",
]

export const EFFECT_LABEL: Record<EffectType, string> = {
  contact_confirmed: "Contact confirmed",
  contact_changed: "Contact changed",
  window_changed: "Window changed",
  call_result_recorded: "Call result recorded",
  eta_reported: "ETA reported",
  customer_answer_recorded: "Customer answer recorded",
  operator_answer_recorded: "Operator answer recorded",
  cost_approved: "Cost approved",
}

/** What an effect event changes: one variant per type. */
export type Effect =
  /** `confirmedBy`: who confirmed the contact for this order, e.g. "Calverona Auto (paying customer)". */
  | { type: "contact_confirmed"; endpointId: string; confirmedBy: string }
  /** `statedBy`: who gave the new contact. Absent fields keep their value. */
  | { type: "contact_changed"; endpointId: string; name?: string | null; handle?: string | null; role?: string | null; statedBy: string }
  /** A SELECTED_PICKUP_SLOT or CUSTOMER_DELIVERY_PROMISE window; times are ISO (UTC). */
  | { type: "window_changed"; windowId: string; startAt: string; endAt: string; statedBy: string }
  /** `with`: who was on the call; `claim`: what they said; `callId`: the call it came from. */
  | { type: "call_result_recorded"; with: string; claim: string; callId?: string | null }
  /**
   * A new ETA (ISO, UTC) for the car, as a time: `statedBy` said it (the driver on a call)
   * at `statedAt`. It is the driver's statement, not a change to the order: the delivery
   * promise stays as the customer set it (ADR 0001).
   */
  | { type: "eta_reported"; etaAt: string; statedBy: string; statedAt: string; assignmentId?: string | null; callId?: string | null }
  | { type: "customer_answer_recorded"; from: string; question: string; answer: string }
  | { type: "operator_answer_recorded"; question: string; answer: string }
  /** Approves an existing expense (`expenseId`), or adds a cost line (`amountCents`, `currency`, `kind`). */
  | { type: "cost_approved"; expenseId?: string | null; amountCents?: number | null; currency?: string | null; kind?: string | null; note?: string | null }

/** What fact an effect settles, and what it replaces. Optional for writers; the engine fills the defaults. */
export type Versioning = {
  /**
   * The fact it writes a new version of: a stable key and a label ("who may receive
   * and sign at delivery"). Default: the endpoint/window/expense it changes; for a
   * claim, the question it answers (its source).
   */
  fact?: { key: string; label: string } | null
  /**
   * The records this version replaces: older statements on the same point by the
   * party who now answered (message, note, endpoint detail ids). Marked superseded
   * in the overlay; never removed.
   */
  supersedes?: string[]
  /** Proposals whose question it answers: their recorded answers are read as this event from now on. */
  answers?: string[]
}

/** What a writer hands the engine (`recordEffect`, or a change proposal's `effect`). */
export type EffectInput = Effect & Versioning & {
  orderId: string
  /** Who committed it: the operator (a yes, an answer), the agent (a call result), or the policy. */
  by: Actor
  /** Where it came from: a proposal id, a call id. */
  source: string
}

/** What `recordEffect` takes: an effect on an order; `by` defaults to the agent. */
/** An effect with its versioning: what a change proposal carries. */
export type EffectSpec = Effect & Versioning

export type EffectWrite = EffectSpec & { orderId: string; source: string; by?: Actor }

/** An effect event as stored and read back. */
export type EffectEvent = EffectInput & {
  id: string
  fact: { key: string; label: string }
  /** The fact's version this event writes: 2 for the first effect on a fact (1 is the snapshot). */
  version: number
  supersedes: string[]
  /** Demo-clock time it was committed. */
  at: string
  /** One line for the history: what changed and who approved it. */
  text: string
}

const BY_LABEL: Record<Actor, string> = { operator: "the operator", agent: "the agent", policy: "the approval policy" }

function shortHash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 12)
}

export function effectId(input: EffectInput, at: string, seq: number): string {
  return `eff-${shortHash(input.orderId, input.type, input.source, at, String(seq), JSON.stringify(input))}`
}

function quoted(text: string): string {
  return `"${text.trim().replace(/[.]$/, "")}"`
}

function rowOf(bundle: Bundle, collection: string, id: string | null | undefined): RelatedRow | null {
  return id ? rows(bundle, collection).find((row) => row.id === id) ?? null : null
}

/** What the effect does, in one sentence, naming the record it changes. */
export function describeEffect(bundle: Bundle, effect: Effect): string {
  switch (effect.type) {
    case "contact_confirmed": {
      const row = rowOf(bundle, "order_endpoint_details", effect.endpointId)
      const name = str(row?.details.contact_name) ?? "the contact"
      return `${String(row?.details.boundary ?? "").toLowerCase() || "endpoint"} contact ${name} confirmed for this order by ${effect.confirmedBy}`
    }
    case "contact_changed": {
      const row = rowOf(bundle, "order_endpoint_details", effect.endpointId)
      const parts = [effect.name, effect.handle, effect.role].filter((part): part is string => !!part)
      return `${String(row?.details.boundary ?? "").toLowerCase() || "endpoint"} contact changed to ${parts.join(", ")} (given by ${effect.statedBy})`
    }
    case "window_changed": {
      const row = rowOf(bundle, "time_windows", effect.windowId)
      const what = row?.details.purpose === "SELECTED_PICKUP_SLOT" ? "selected pickup slot" : "delivery promise"
      return `${what} moved to ${effect.startAt} - ${effect.endAt} (from ${effect.statedBy})`
    }
    case "call_result_recorded":
      return `${effect.with} said on the call: ${quoted(effect.claim)}`
    case "eta_reported":
      return `${effect.statedBy} reported a new ETA of ${effect.etaAt}`
    case "customer_answer_recorded":
      return `${effect.from} answered: ${quoted(effect.answer)}`
    case "operator_answer_recorded":
      return `the operator answered: ${quoted(effect.answer)}`
    case "cost_approved": {
      if (effect.expenseId) {
        const row = rowOf(bundle, "expenses", effect.expenseId)
        const kind = String(row?.details.kind ?? "expense").toLowerCase().replace(/_/g, " ")
        return `${kind} ${effect.expenseId} approved`
      }
      return `cost line approved: ${effect.amountCents ?? 0} ${effect.currency ?? "EUR"} cents for ${String(effect.kind ?? "cost").toLowerCase().replace(/_/g, " ")}`
    }
  }
}

/** The history line: the label, what changed, and who approved it. */
export function effectText(bundle: Bundle, input: EffectInput): string {
  return `${EFFECT_LABEL[input.type]}: ${describeEffect(bundle, input)}. Committed by ${BY_LABEL[input.by]}.`
}

/** Refuses an effect whose target record is not on the order, or whose text is empty. */
export function checkEffect(bundle: Bundle, effect: Effect): void {
  const must = (ok: unknown, message: string) => { if (!ok) throw new Error(`${bundle.order.reference}: ${message}`) }
  const text = (value: string | null | undefined, what: string) => must(value && value.trim(), `${what} cannot be empty`)
  switch (effect.type) {
    case "contact_confirmed":
      must(rowOf(bundle, "order_endpoint_details", effect.endpointId), `no endpoint ${effect.endpointId} on this order`)
      text(effect.confirmedBy, "who confirmed the contact")
      return
    case "contact_changed":
      must(rowOf(bundle, "order_endpoint_details", effect.endpointId), `no endpoint ${effect.endpointId} on this order`)
      must(effect.name || effect.handle || effect.role, "a contact change needs a name, handle or role")
      text(effect.statedBy, "who gave the contact")
      return
    case "window_changed": {
      const row = rowOf(bundle, "time_windows", effect.windowId)
      must(row, `no window ${effect.windowId} on this order`)
      must(row?.details.purpose === "SELECTED_PICKUP_SLOT" || row?.details.purpose === "CUSTOMER_DELIVERY_PROMISE", "only the selected pickup slot or the delivery promise can change")
      const start = Date.parse(effect.startAt)
      const end = Date.parse(effect.endAt)
      must(Number.isFinite(start) && Number.isFinite(end) && start < end, "a window needs a start before its end")
      text(effect.statedBy, "who asked for the window")
      return
    }
    case "call_result_recorded":
      text(effect.with, "who was on the call")
      text(effect.claim, "the call result")
      return
    case "eta_reported":
      must(Number.isFinite(Date.parse(effect.etaAt)), "an ETA needs a time")
      must(Number.isFinite(Date.parse(effect.statedAt)), "an ETA needs the time it was stated")
      text(effect.statedBy, "who reported the ETA")
      if (effect.assignmentId) must(rowOf(bundle, "work_assignments", effect.assignmentId), `no assignment ${effect.assignmentId} on this order`)
      return
    case "customer_answer_recorded":
      text(effect.from, "who answered")
      text(effect.answer, "the answer")
      return
    case "operator_answer_recorded":
      text(effect.answer, "the answer")
      return
    case "cost_approved":
      if (effect.expenseId) must(rowOf(bundle, "expenses", effect.expenseId), `no expense ${effect.expenseId} on this order`)
      else must(typeof effect.amountCents === "number" && effect.amountCents > 0 && effect.kind, "a new cost line needs an amount and a kind")
      return
  }
}

/**
 * The records a new answer replaces: the statements cited on the question it answers
 * (the "conflict" side of the evidence) that were made by the party who now answered.
 * Statements by anyone else stay live, so a real disagreement is still a conflict.
 */
export function statementsBy(evidence: { recordId: string; role: string; statedBy: string | null }[], party: (statedBy: string) => boolean): string[] {
  return [...new Set(evidence.filter((cited) => cited.role === "conflict" && cited.statedBy && party(cited.statedBy)).map((cited) => cited.recordId))]
}

/** Whether a record's stated_by is the customer side (the customer, or a contact the customer gave). */
export const isCustomerStatement = (statedBy: string) => /^customer(:|$)/i.test(statedBy) || statedBy === "CUSTOMER_ORDER_INPUT"

/** The record an effect changes in place (endpoint, window, expense), or null for a claim. */
export function effectTarget(effect: Effect): { collection: string; id: string } | null {
  switch (effect.type) {
    case "contact_confirmed":
    case "contact_changed": return { collection: "order_endpoint_details", id: effect.endpointId }
    case "window_changed": return { collection: "time_windows", id: effect.windowId }
    case "cost_approved": return effect.expenseId ? { collection: "expenses", id: effect.expenseId } : null
    default: return null
  }
}

/** The fact an effect writes a version of, when the writer named none. */
export function defaultFact(bundle: Bundle, input: Effect & { source: string }): { key: string; label: string } {
  const target = effectTarget(input)
  if (input.type === "contact_confirmed" || input.type === "contact_changed") {
    const row = rowOf(bundle, "order_endpoint_details", input.endpointId)
    return { key: `${input.endpointId}:contact`, label: `${String(row?.details.boundary ?? "endpoint").toLowerCase()} contact` }
  }
  if (target) return { key: `${target.id}`, label: `${target.collection.replace(/_/g, " ")} ${target.id}` }
  if (input.type === "cost_approved") return { key: `cost:${input.source}`, label: "cost line" }
  if (input.type === "eta_reported") return { key: `eta:${input.assignmentId ?? bundle.order.id}`, label: "the car's ETA" }
  if (input.type === "customer_answer_recorded" || input.type === "operator_answer_recorded") return { key: `answer:${input.source}`, label: input.question || "answer" }
  return { key: `claim:${input.source}`, label: "call result" }
}

/** The values of a changed record before an effect, kept on the row as its earlier version. */
const VERSIONED_FIELDS: Record<string, string[]> = {
  order_endpoint_details: ["contact_name", "contact_handle", "contact_role", "contact_status", "last_confirmed_at", "last_confirmed_source", "stated_by", "stated_at"],
  time_windows: ["start_at", "end_at", "source"],
  expenses: ["status"],
}

function replaceRow(bundle: Bundle, collection: string, id: string, event: EffectEvent, change: (details: Row) => Row): void {
  bundle.related[collection] = rows(bundle, collection).map((row) => {
    if (row.id !== id) return row
    const before = Object.fromEntries((VERSIONED_FIELDS[collection] ?? []).filter((key) => key in row.details).map((key) => [key, row.details[key]]))
    const previous = Array.isArray(row.details.previous_versions) ? row.details.previous_versions : []
    const version = typeof row.details.version === "number" ? row.details.version : 1
    return {
      id: row.id,
      details: {
        ...change({ ...row.details }),
        version: event.version,
        version_note: `Current value: version ${event.version}, written by effect event ${event.id} at ${event.at}. Earlier versions are superseded history.`,
        previous_versions: [...previous, { version, status: "SUPERSEDED", superseded_by: event.id, ...before }],
      },
    }
  })
}

const supersededNote = (event: EffectEvent) =>
  `SUPERSEDED by effect event ${event.id} (version ${event.version} of "${event.fact.label}", ${event.at}); kept as history.`

/** Marks a record superseded wherever it sits in the bundle. Its own fields are kept as they were. */
function markSuperseded(bundle: Bundle, recordId: string, event: EffectEvent): void {
  const mark = <T extends { id: string; details: Row }>(list: T[]): T[] =>
    list.map((row) => row.id === recordId ? { ...row, details: { ...row.details, superseded_by: event.id, superseded_note: supersededNote(event) } } : row)
  bundle.messages = mark(bundle.messages)
  bundle.conversations = mark(bundle.conversations)
  bundle.alerts = mark(bundle.alerts)
  for (const [collection, list] of Object.entries(bundle.related)) {
    if (list?.some((row) => row.id === recordId)) bundle.related[collection] = mark(list)
  }
}

/** Who the record attributes the claim to. */
function statedBy(event: EffectEvent): string {
  switch (event.type) {
    case "contact_confirmed": return event.confirmedBy
    case "contact_changed": return event.statedBy
    case "window_changed": return event.statedBy
    case "call_result_recorded": return event.with
    case "eta_reported": return event.statedBy
    case "customer_answer_recorded": return event.from
    case "operator_answer_recorded": return "operator"
    case "cost_approved": return "operator"
  }
}

/** The event as a record the reviewer reads: attributed, timestamped, and marked as superseding older statements. */
function eventRow(bundle: Bundle, event: EffectEvent): RelatedRow {
  const { id: _id, orderId: _o, by, source, at, text: _t, type, answers: _a, ...fields } = event
  const who = statedBy(event)
  return {
    id: event.id,
    details: {
      order_id: bundle.order.id,
      effect: type.toUpperCase(),
      recorded_at: at,
      stated_by: who,
      source: "control_room",
      committed_by: by,
      from_record: source,
      ...fields,
      summary: describeEffect(bundle, event),
      status: "CURRENT",
      version_note: `Committed effect event: version ${event.version} of "${event.fact.label}", the newest word from ${who} on this point.`
        + (event.supersedes.length ? ` It supersedes ${event.supersedes.join(", ")}.` : ""),
    },
  }
}

/**
 * The order with its effect events applied, oldest first. Returns a new bundle;
 * the input (the snapshot) is never changed.
 */
export function applyEffects(snapshot: Bundle, events: EffectEvent[]): Bundle {
  if (!events.length) return snapshot
  const bundle: Bundle = { ...snapshot, related: { ...snapshot.related } }
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at))
  for (const event of sorted) {
    // An older version of the same fact, and every record this one replaces, become history.
    for (const older of rows(bundle, "effect_events")) {
      const fact = older.details.fact as { key?: string } | undefined
      if (fact?.key === event.fact.key && !older.details.superseded_by) markSuperseded(bundle, older.id, event)
    }
    const target = effectTarget(event)
    for (const recordId of event.supersedes) if (recordId !== target?.id) markSuperseded(bundle, recordId, event)
    switch (event.type) {
      case "contact_confirmed":
        replaceRow(bundle, "order_endpoint_details", event.endpointId, event, (details) => ({
          ...details, contact_status: "CONFIRMED", last_confirmed_at: event.at, last_confirmed_source: "CONTROL_ROOM_EFFECT", confirmed_by: event.confirmedBy,
        }))
        break
      case "contact_changed":
        replaceRow(bundle, "order_endpoint_details", event.endpointId, event, (details) => ({
          ...details,
          ...(event.name ? { contact_name: event.name } : {}),
          ...(event.handle ? { contact_handle: event.handle } : {}),
          ...(event.role ? { contact_role: event.role } : {}),
          stated_by: event.statedBy, stated_at: event.at,
        }))
        break
      case "window_changed":
        replaceRow(bundle, "time_windows", event.windowId, event, (details) => ({
          ...details, start_at: new Date(event.startAt).toISOString().replace(".000Z", "Z"), end_at: new Date(event.endAt).toISOString().replace(".000Z", "Z"),
          changed_at: event.at, changed_by: event.statedBy,
        }))
        break
      case "cost_approved":
        if (event.expenseId) {
          replaceRow(bundle, "expenses", event.expenseId, event, (details) => ({ ...details, status: "APPROVED", approved_at: event.at }))
        } else {
          bundle.related.expenses = [...rows(bundle, "expenses"), {
            id: `${event.id}-cost`,
            details: {
              order_id: bundle.order.id, kind: event.kind, amount_cents: event.amountCents, currency: event.currency ?? "EUR", status: "APPROVED",
              submitted_at: event.at, approved_at: event.at, note: event.note ?? null, source: "control_room",
            },
          }]
        }
        break
      default:
        break
    }
    bundle.related.effect_events = [...rows(bundle, "effect_events"), eventRow(bundle, event)]
  }
  return bundle
}
