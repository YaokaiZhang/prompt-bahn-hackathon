// What the reviewer reads: the engine's snapshot (one bundle per order) plus the
// support inbox messages, which have no order id and so sit in no bundle. The
// read-only tools look up the driver's other duties, related orders, site
// profiles and inbox threads here.

import { eq } from "drizzle-orm"
import type { Snapshot } from "@/lib/engine/engine"
import type { Database } from "@/lib/engine/postgres"
import { snapshotFromDatabase, snapshotFromTables } from "@/lib/engine/snapshot"
import type { Bundle, RelatedRow } from "@/lib/present/bundle"
import { relatedRecords } from "@/lib/schema"
import { readSnapshotTables } from "@/lib/snapshot/files"
import type { SnapshotTables } from "@/lib/snapshot/tables"

export type ReviewSource = {
  snapshot: Snapshot
  /** `support_inbox_messages` rows: threads are on the bundles, their messages are here. */
  inboxMessages: RelatedRow[]
}

const INBOX_MESSAGES = "support_inbox_messages"

export function reviewSourceFromTables(tables: SnapshotTables): ReviewSource {
  return {
    snapshot: snapshotFromTables(tables),
    inboxMessages: tables.relatedRecords.filter((row) => row.collection === INBOX_MESSAGES).map((row) => ({ id: row.id, details: row.details })),
  }
}

/** Reads ../dataset/data, or DATASET_DIR, or `dir`. */
export async function reviewSourceFromFiles(dir?: string): Promise<ReviewSource> {
  return reviewSourceFromTables(await readSnapshotTables(dir))
}

/** The app's path: the seeded starter tables. Pass the engine's snapshot if it is already loaded. */
export async function reviewSourceFromDatabase(db: Database, snapshot?: Snapshot): Promise<ReviewSource> {
  const [loaded, rows] = await Promise.all([
    snapshot ?? snapshotFromDatabase(db),
    db.select().from(relatedRecords).where(eq(relatedRecords.collection, INBOX_MESSAGES)),
  ])
  return { snapshot: loaded, inboxMessages: rows.map((row) => ({ id: row.id, details: row.details })) }
}

/** Finds an order by id (`ord-00516`) or reference (`CD-420516`). */
export function findBundle(source: ReviewSource, orderIdOrReference: string): Bundle | null {
  const key = orderIdOrReference.trim()
  return source.snapshot.bundles.find((bundle) => bundle.order.id === key || bundle.order.reference.toUpperCase() === key.toUpperCase()) ?? null
}
