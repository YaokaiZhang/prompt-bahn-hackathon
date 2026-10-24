// Records in the compact, normalised form the reviewer reads and cites: one shape
// for every collection, with its id, time, source and who stated it.

import { fmtDateTime } from "@/lib/present/time"
import type { Row } from "@/lib/present/types"

export type CaseRecord = {
  id: string
  /** The collection, e.g. `message`, `order_endpoint_details`, `site_profile`. */
  kind: string
  /** The record's own time (when it was said, recorded, observed...), ISO; null for reference data. */
  at: string | null
  /** `at` in the record's local zone, e.g. "21 Oct 11:24 EEST". */
  local: string | null
  /** Channel or system the record came from. */
  source: string
  /** Who stated it: the dataset's `stated_by`, or `author_type:author_id` / `actor_type:actor_id`. */
  statedBy: string | null
  fields: Row
}

/** Time fields in priority order: the first one present is the record's time. */
const TIME_KEYS = [
  "authored_at", "recorded_at", "triggered_at", "observed_at", "submitted_at", "stated_at", "opened_at", "booked_at",
  "service_at", "checked_at", "shown_at", "visited_at", "reported_at", "started_at", "created_at", "accepted_at",
  "published_at", "updated_at", "start_at", "scheduled_start_at",
]

/** Future-facing times that get a resolved local twin (`<key>_local`). */
const LOCAL_KEYS = [
  "start_at", "end_at", "scheduled_start_at", "scheduled_end_at", "estimated_delivery_at", "due_at", "next_check_at",
  "departure_at", "arrival_at", "expected_arrival_at", "commitment_deadline_at", "check_in_cutoff_at", "expires_at",
]

/** Keys that repeat what the record header already says. */
const DROP_KEYS = new Set(["id", "order_id"])

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact)
  if (value && typeof value === "object") {
    const out: Row = {}
    for (const [key, inner] of Object.entries(value as Row)) {
      if (inner === null || inner === undefined) continue
      if (Array.isArray(inner) && inner.length === 0) continue
      out[key] = compact(inner)
    }
    return out
  }
  return value
}

export function localTime(value: string | null, zone: string | null): string | null {
  if (!value) return null
  return fmtDateTime(value, zone ?? "UTC")
}

export type RecordInput = {
  id: string
  kind: string
  details: Row
  /** Fallback zone when the record carries no `timezone`. */
  zone: string | null
  source?: string | null
  statedBy?: string | null
  at?: string | null
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function who(details: Row, type: string, id: string): string | null {
  const t = str(details[type])
  const i = str(details[id])
  if (!t && !i) return null
  return [t, i].filter(Boolean).join(":")
}

export function toCaseRecord(input: RecordInput): CaseRecord {
  const { details } = input
  const zone = str(details.timezone) ?? input.zone
  const at = input.at !== undefined ? input.at : TIME_KEYS.map((key) => iso(details[key])).find(Boolean) ?? null
  const fields = compact(Object.fromEntries(Object.entries(details).filter(([key]) => !DROP_KEYS.has(key)))) as Row
  for (const key of LOCAL_KEYS) {
    const value = iso(details[key])
    if (value) fields[`${key.replace(/_at$/, "")}_local`] = localTime(value, zone)
  }
  return {
    id: input.id,
    kind: input.kind,
    at,
    local: localTime(at, zone),
    source: input.source ?? str(details.source) ?? str(details.channel) ?? str(details.submission_source) ?? "dataset",
    statedBy: input.statedBy !== undefined
      ? input.statedBy
      : str(details.stated_by) ?? who(details, "author_type", "author_id") ?? who(details, "actor_type", "actor_id")
        ?? str(details.created_by) ?? (str(details.driver_id) ? `driver:${details.driver_id}` : null),
    fields,
  }
}

/** Untimed reference records first, then oldest first; ties by id. */
export function sortRecords(records: CaseRecord[]): CaseRecord[] {
  return [...records].sort((a, b) => {
    if (!a.at !== !b.at) return a.at ? 1 : -1
    if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** One line per record: a header the model cites by id, then the fields as JSON. */
export function renderRecord(record: CaseRecord): string {
  const head = [`[${record.id}] ${record.kind}`]
  if (record.at) head.push(`${record.at} (${record.local})`)
  head.push(`source ${record.source}`)
  if (record.statedBy) head.push(`stated_by ${record.statedBy}`)
  // A control-room effect event wrote a newer version of what this record states (ticket 09).
  if (typeof record.fields.superseded_by === "string") head.push(`SUPERSEDED by ${record.fields.superseded_by} (history)`)
  return `${head.join(" · ")}\n  ${JSON.stringify(record.fields)}`
}
