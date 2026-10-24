// Effect events (ticket 09, ADR 0002): every committed change to an order is an
// append-only effect event in our own tables. The snapshot rows are never edited;
// `applyEffects` lays the events over a bundle, and the order view, the rules and
// the reviewer all read that overlaid bundle.
//
// Seven types (spec "Our own tables"):
//   contact_confirmed          endpoint contact_status / last_confirmed_source / last_confirmed_at
//   contact_changed            endpoint contact name, handle and role
//   window_changed             the selected pickup slot or the delivery promise (start/end)
//   call_result_recorded       an attributed claim; the source is the call
//   customer_answer_recorded   an attributed claim; the source is the operator's record of the customer
//   operator_answer_recorded   an attributed note by the operator
//   cost_approved              an expense approved, or a new cost line
//
// Every event is also listed as a record of its own (`related.effect_events`): an
// attributed, timestamped claim the reviewer can read and cite. It is the newest
// word of whoever it is attributed to, so it supersedes their older statements on
// the same point.
//
// Pure: bundle and events in, bundle out.

import { createHash } from "node:crypto"
import { rows, str, type Bundle, type RelatedRow } from "@/lib/present/bundle"
import type { Row } from "@/lib/present/types"
import type { Actor } from "./proposals"

export type EffectType =
  | "contact_confirmed" | "contact_changed" | "window_changed"
  | "call_result_recorded" | "customer_answer_recorded" | "operator_answer_recorded" | "cost_approved"

export const EFFECT_TYPES: EffectType[] = [
  "contact_confirmed", "contact_changed", "window_changed", "call_result_recorded", "customer_answer_recorded", "operator_answer_recorded", "cost_approved",
]

export const EFFECT_LABEL: Record<EffectType, string> = {
  contact_confirmed: "Contact confirmed",
  contact_changed: "Contact changed",
  window_changed: "Window changed",
  call_result_recorded: "Call result recorded",
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
  | { type: "customer_answer_recorded"; from: string; question: string; answer: string }
  | { type: "operator_answer_recorded"; question: string; answer: string }
  /** Approves an existing expense (`expenseId`), or adds a cost line (`amountCents`, `currency`, `kind`). */
  | { type: "cost_approved"; expenseId?: string | null; amountCents?: number | null; currency?: string | null; kind?: string | null; note?: string | null }

/** What a writer hands the engine (`recordEffect`, or a change proposal's `effect`). */
export type EffectInput = Effect & {
  orderId: string
  /** Who committed it: the operator (a yes, an answer), the agent (a call result), or the policy. */
  by: Actor
  /** Where it came from: a proposal id, a call id. */
  source: string
}

/** What `recordEffect` takes: an effect on an order; `by` defaults to the agent. */
export type EffectWrite = Effect & { orderId: string; source: string; by?: Actor }

/** An effect event as stored and read back. */
export type EffectEvent = EffectInput & {
  id: string
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

function replaceRow(bundle: Bundle, collection: string, id: string, change: (details: Row) => Row): void {
  bundle.related[collection] = rows(bundle, collection).map((row) => row.id === id ? { id: row.id, details: change({ ...row.details }) } : row)
}

/** Who the record attributes the claim to. */
function statedBy(event: EffectEvent): string {
  switch (event.type) {
    case "contact_confirmed": return event.confirmedBy
    case "contact_changed": return event.statedBy
    case "window_changed": return event.statedBy
    case "call_result_recorded": return event.with
    case "customer_answer_recorded": return event.from
    case "operator_answer_recorded": return "operator"
    case "cost_approved": return "operator"
  }
}

/** The event as a record the reviewer reads: attributed, timestamped, and marked as superseding older statements. */
function eventRow(bundle: Bundle, event: EffectEvent): RelatedRow {
  const { id: _id, orderId: _o, by, source, at, text: _t, type, ...fields } = event
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
      supersedes: `Committed effect event: the newest word from ${who} on this point; it supersedes their earlier statements on the same point.`,
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
    switch (event.type) {
      case "contact_confirmed":
        replaceRow(bundle, "order_endpoint_details", event.endpointId, (details) => ({
          ...details, contact_status: "CONFIRMED", last_confirmed_at: event.at, last_confirmed_source: "CONTROL_ROOM_EFFECT", confirmed_by: event.confirmedBy,
        }))
        break
      case "contact_changed":
        replaceRow(bundle, "order_endpoint_details", event.endpointId, (details) => ({
          ...details,
          ...(event.name ? { contact_name: event.name } : {}),
          ...(event.handle ? { contact_handle: event.handle } : {}),
          ...(event.role ? { contact_role: event.role } : {}),
          stated_by: event.statedBy, stated_at: event.at,
        }))
        break
      case "window_changed":
        replaceRow(bundle, "time_windows", event.windowId, (details) => ({
          ...details, start_at: new Date(event.startAt).toISOString().replace(".000Z", "Z"), end_at: new Date(event.endAt).toISOString().replace(".000Z", "Z"),
          changed_at: event.at, changed_by: event.statedBy,
        }))
        break
      case "cost_approved":
        if (event.expenseId) {
          replaceRow(bundle, "expenses", event.expenseId, (details) => ({ ...details, status: "APPROVED", approved_at: event.at }))
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
