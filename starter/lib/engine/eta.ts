// The car's current ETA, read from the overlaid bundle (pure). Two kinds of record
// state an ETA: the tracking observations (the driver app's estimate) and the
// `eta_reported` effect events (what the driver said on a call, as a time). The
// newest statement is the current ETA; an older one, or one a newer version
// superseded, is history. The tight-ETA check, R12 and the voice agent's brief all
// read the ETA here, so a driver's "about 16:30" replaces the 13:58 tracking estimate.

import { rows, str, type Bundle } from "@/lib/present/bundle"

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
