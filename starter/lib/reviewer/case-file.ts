// The prepared case file: the reviewer's first message for one order. It holds the
// order's records (normalised, oldest first), "now", the rule results and the prior
// state from our tables. Its hash is the review cache key.

import { createHash } from "node:crypto"
import type { Bundle } from "@/lib/present/bundle"
import { localTime, renderRecord, sortRecords, toCaseRecord, type CaseRecord } from "./records"
import type { ReviewSource } from "./source"

/**
 * A rule check's result as the reviewer reads it. The rule engine (ticket 03)
 * produces these; the caller maps them in, so the reviewer does not import rules.
 */
export type RuleResult = {
  /** Rule id, e.g. "R1". */
  rule: string
  status: "passed" | "failed" | "couldnt_check"
  summary: string
  recordIds?: string[]
}

/** What our own tables know about earlier runs. Every item has an id the reviewer can cite. */
export type PriorState = {
  findings?: { id: string; at: string; title: string; question: string; status: string }[]
  /** Questions already asked and still open: the reviewer must not re-ask them. */
  openQuestions?: { id: string; at: string; to: string; question: string; nextCheckAt?: string | null }[]
  instructions?: { id: string; at: string; by: string; text: string }[]
  callResults?: { id: string; at: string; with: string; summary: string }[]
  /** Answers the operator recorded: a customer's answer after a customer-side contact, or the operator's own answer to a question. */
  answers?: { id: string; at: string; from: string; question: string; answer: string }[]
}

export type CaseInput = {
  /** The demo clock, ISO. */
  now: string
  rules?: RuleResult[]
  prior?: PriorState
}

export type CaseFile = {
  orderId: string
  reference: string
  now: string
  nowLocal: string | null
  zone: string | null
  customer: { id: string; name: string }
  rules: RuleResult[]
  records: CaseRecord[]
}

const CORE_ZONE_COLLECTIONS = ["time_windows"]

/** The order's local zone: its pickup window's zone, else the pickup site's. */
export function orderZone(bundle: Bundle): string | null {
  for (const collection of CORE_ZONE_COLLECTIONS) {
    for (const row of bundle.related[collection] ?? []) {
      if (typeof row.details.timezone === "string") return row.details.timezone
    }
  }
  for (const id of [bundle.order.pickupSiteId, bundle.order.deliverySiteId]) {
    const zone = id ? bundle.sites.get(id)?.details.timezone : null
    if (typeof zone === "string") return zone
  }
  return null
}

/** Site ids the order touches: its endpoints and every point of its plans. */
function siteIds(bundle: Bundle): string[] {
  const ids = new Set<string>()
  for (const id of [bundle.order.pickupSiteId, bundle.order.deliverySiteId]) if (id) ids.add(id)
  for (const point of bundle.related.transport_points ?? []) if (typeof point.details.site_id === "string") ids.add(point.details.site_id)
  return [...ids].sort()
}

export function bundleRecords(bundle: Bundle, zone: string | null): CaseRecord[] {
  const records: CaseRecord[] = []
  const { order } = bundle
  records.push(toCaseRecord({ id: order.id, kind: "order", details: order.details, zone, source: String(order.details.source ?? "dataset") }))
  records.push(toCaseRecord({
    id: bundle.customer.id, kind: "customer", zone, at: null, statedBy: null,
    details: { name: bundle.customer.name, tier: bundle.customer.tier, country: bundle.customer.country, pays_for_order: order.id },
  }))
  for (const item of bundle.items) {
    records.push(toCaseRecord({
      id: item.id, kind: "order_item", zone, at: null, statedBy: null,
      details: { ...item.details, vehicle: item.vehicle },
    }))
  }
  for (const alert of bundle.alerts) records.push(toCaseRecord({ id: alert.id, kind: "alert", details: alert.details, zone }))
  for (const thread of bundle.conversations) {
    records.push(toCaseRecord({ id: thread.id, kind: "conversation", details: thread.details, zone, statedBy: null }))
  }
  for (const message of bundle.messages) records.push(toCaseRecord({ id: message.id, kind: "message", details: message.details, zone }))
  for (const event of bundle.events) records.push(toCaseRecord({ id: event.id, kind: "operational_event", details: event.details, zone }))
  for (const [collection, rows] of Object.entries(bundle.related).sort(([a], [b]) => a.localeCompare(b))) {
    for (const row of rows ?? []) records.push(toCaseRecord({ id: row.id, kind: collection, details: row.details, zone }))
  }
  const addressIds = new Set([order.pickupAddressId, order.deliveryAddressId])
  for (const point of bundle.related.transport_points ?? []) if (typeof point.details.address_id === "string") addressIds.add(point.details.address_id)
  for (const id of [...addressIds].sort()) {
    const place = bundle.places.get(id)
    if (place) records.push(toCaseRecord({ id: place.id, kind: "address", details: place.details, zone, at: null, source: "address_book", statedBy: null }))
  }
  for (const id of siteIds(bundle)) {
    const site = bundle.sites.get(id)
    if (site) records.push(toCaseRecord({ id: site.id, kind: "site_profile", details: site.details, zone, at: null, source: "site_profile", statedBy: null }))
  }
  for (const thread of bundle.inboxThreads) {
    records.push(toCaseRecord({ id: thread.id, kind: "inbox_thread", details: thread.details, zone, source: "support_inbox", statedBy: null }))
  }
  return records
}

function priorRecords(prior: PriorState | undefined, zone: string | null): CaseRecord[] {
  if (!prior) return []
  const records: CaseRecord[] = []
  for (const item of prior.findings ?? []) {
    records.push(toCaseRecord({ id: item.id, kind: "prior_finding", zone, at: item.at, source: "reviewer", statedBy: "agent:reviewer", details: { title: item.title, question: item.question, status: item.status } }))
  }
  for (const item of prior.openQuestions ?? []) {
    records.push(toCaseRecord({ id: item.id, kind: "open_question", zone, at: item.at, source: "control_room", statedBy: "agent", details: { to: item.to, question: item.question, next_check_at: item.nextCheckAt ?? null } }))
  }
  for (const item of prior.instructions ?? []) {
    records.push(toCaseRecord({ id: item.id, kind: "operator_instruction", zone, at: item.at, source: "control_room", statedBy: item.by, details: { text: item.text } }))
  }
  for (const item of prior.callResults ?? []) {
    records.push(toCaseRecord({ id: item.id, kind: "call_result", zone, at: item.at, source: "call", statedBy: item.with, details: { summary: item.summary } }))
  }
  for (const item of prior.answers ?? []) {
    records.push(toCaseRecord({ id: item.id, kind: "recorded_answer", zone, at: item.at, source: "control_room", statedBy: item.from, details: { question: item.question, answer: item.answer } }))
  }
  return records
}

export function buildCaseFile(bundle: Bundle, _source: ReviewSource, input: CaseInput): CaseFile {
  const zone = orderZone(bundle)
  const now = new Date(input.now).toISOString()
  return {
    orderId: bundle.order.id,
    reference: bundle.order.reference,
    now,
    nowLocal: localTime(now, zone),
    zone,
    customer: { id: bundle.customer.id, name: bundle.customer.name },
    rules: [...(input.rules ?? [])],
    records: sortRecords([...bundleRecords(bundle, zone), ...priorRecords(input.prior, zone)]),
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
  }
  return value
}

/** The cache key's input: any change to records, rules, prior state or now changes it. */
export function caseFileHash(file: CaseFile): string {
  return createHash("sha256").update(JSON.stringify(canonical(file))).digest("hex")
}

export function renderCaseFile(file: CaseFile): string {
  const lines: string[] = []
  lines.push(`# Case file ${file.reference} (${file.orderId})`)
  lines.push(`Now: ${file.now} (${file.nowLocal ?? "UTC"}; order zone ${file.zone ?? "UTC"})`)
  lines.push(`Customer (pays Bahn): ${file.customer.id} ${file.customer.name}`)
  lines.push("")
  lines.push("## Rule results")
  if (file.rules.length === 0) lines.push("- none supplied")
  for (const rule of file.rules) {
    const refs = rule.recordIds?.length ? ` [${rule.recordIds.join(", ")}]` : ""
    lines.push(`- ${rule.rule} ${rule.status}: ${rule.summary}${refs}`)
  }
  lines.push("")
  lines.push(`## Records (${file.records.length}; reference data first, then oldest first)`)
  for (const record of file.records) lines.push(renderRecord(record))
  return lines.join("\n")
}
