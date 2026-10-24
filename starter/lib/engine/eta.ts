// The car's current ETA, read from the overlaid bundle (pure). Two kinds of record
// state an ETA: the tracking observations (the driver app's estimate) and the
// `eta_reported` effect events (what the driver said on a call, as a time). The
// newest statement is the current ETA; an older one, or one a newer version
// superseded, is history. The tight-ETA check, R12 and the voice agent's brief all
// read the ETA here, so a driver's "about 16:30" replaces the 13:58 tracking estimate.

import { rows, str, type Bundle, type RelatedRow } from "@/lib/present/bundle"

/**
 * The record that stands for `row` now: the row itself while it is current, else the
 * effect event that superseded it (following newer versions of that event). Rules read
 * this, so a call result or a reported ETA answers what it superseded.
 */
export function currentRecord(bundle: Bundle, row: RelatedRow): RelatedRow {
  const events = rows(bundle, "effect_events")
  let current = row
  for (let hops = 0; hops < 20 && current.details.superseded_by; hops++) {
    const next = events.find((event) => event.id === current.details.superseded_by)
    if (!next) break
    current = next
  }
  return current
}

/** When a record was stated: an observation's time, a reported ETA's statement time, an effect event's commit time. */
export function statedAt(row: RelatedRow): string | null {
  return str(row.details.observed_at) ?? str(row.details.statedAt) ?? str(row.details.recorded_at)
}

export type PositionStatement = {
  /** A tracking observation, or the effect event (call result, reported ETA) that superseded it. */
  row: RelatedRow
  collection: "tracking_observations" | "effect_events"
  at: string | null
}

/**
 * The newest current word on where an assignment's car is: its latest tracking
 * observation, unless a call result or reported ETA superseded it, and any current
 * ETA the driver reported for it. Null when nothing was ever received.
 */
export function latestPosition(bundle: Bundle, assignmentId: string): PositionStatement | null {
  const statements: RelatedRow[] = []
  const tracking = rows(bundle, "tracking_observations").filter((row) => row.details.assignment_id === assignmentId)
    .sort((a, b) => String(a.details.observed_at ?? "").localeCompare(String(b.details.observed_at ?? ""))).pop()
  if (tracking) statements.push(currentRecord(bundle, tracking))
  for (const row of rows(bundle, "effect_events")) {
    if (row.details.effect !== "ETA_REPORTED" || row.details.superseded_by) continue
    const forAssignment = str(row.details.assignmentId)
    if (!forAssignment || forAssignment === assignmentId) statements.push(row)
  }
  const newest = statements.sort((a, b) => String(statedAt(a) ?? "").localeCompare(String(statedAt(b) ?? ""))).pop()
  if (!newest) return null
  return { row: newest, collection: newest.id === tracking?.id ? "tracking_observations" : "effect_events", at: statedAt(newest) }
}

export type CurrentEta = {
  /** The ETA itself (ISO, UTC). */
  at: string
  /** The record that states it: a tracking observation or an `eta_reported` effect event. */
  collection: "tracking_observations" | "effect_events"
  recordId: string
  /** When it was stated: the observation time, or when the driver said it. */
  statedAt: string
  /** Who said it, for a reported ETA (the driver on the call); null for tracking. */
  statedBy: string | null
  reported: boolean
  /** A call result already answered it (a tracking ETA the driver spoke to without giving a new time). */
  superseded: boolean
}

/** The newest ETA on the order, or null when none was received. */
export function latestEta(bundle: Bundle): CurrentEta | null {
  const tracking = rows(bundle, "tracking_observations").filter((row) => str(row.details.estimated_delivery_at))
    .sort((a, b) => String(a.details.observed_at ?? "").localeCompare(String(b.details.observed_at ?? ""))).pop()
  const candidates: CurrentEta[] = []
  if (tracking) {
    candidates.push({
      at: str(tracking.details.estimated_delivery_at)!, collection: "tracking_observations", recordId: tracking.id,
      statedAt: str(tracking.details.observed_at) ?? "", statedBy: null, reported: false, superseded: !!tracking.details.superseded_by,
    })
  }
  for (const row of rows(bundle, "effect_events")) {
    if (row.details.effect !== "ETA_REPORTED" || row.details.superseded_by) continue
    const at = str(row.details.etaAt)
    if (!at) continue
    candidates.push({
      at, collection: "effect_events", recordId: row.id, statedAt: str(row.details.statedAt) ?? str(row.details.recorded_at) ?? "",
      statedBy: str(row.details.stated_by), reported: true, superseded: false,
    })
  }
  // Newest statement wins; on a tie the driver's word beats the estimate.
  return candidates.sort((a, b) => a.statedAt.localeCompare(b.statedAt) || Number(a.reported) - Number(b.reported)).pop() ?? null
}
