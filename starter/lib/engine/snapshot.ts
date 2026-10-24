// Where the engine's snapshot comes from: the dataset files (tests, scripts) or the
// starter's seeded tables (app). Both go through the same bundle assembler.

import { assembleOrderBundles } from "@/lib/present/assemble"
import {
  addresses, alerts, conversations, customers, datasetMetadata, drivers, messages, operationalEvents, orderItems, orders,
  relatedRecords, sites, vehicles,
} from "@/lib/schema"
import { readSnapshotTables } from "@/lib/snapshot/files"
import type { SnapshotTables } from "@/lib/snapshot/tables"
import type { Snapshot } from "./engine"
import type { Database } from "./postgres"

export function snapshotFromTables(tables: SnapshotTables): Snapshot {
  const snapshotAt = tables.metadata[0]?.snapshotAt
  if (!snapshotAt) throw new Error("The snapshot has no dataset metadata. Seed the database first.")
  return { snapshotAt: snapshotAt.toISOString(), bundles: assembleOrderBundles(tables) }
}

/** Reads ../dataset/data, or DATASET_DIR, or `dir`. */
export async function snapshotFromFiles(dir?: string): Promise<Snapshot> {
  return snapshotFromTables(await readSnapshotTables(dir))
}

export async function snapshotFromDatabase(db: Database): Promise<Snapshot> {
  const [metadata, customerRows, siteRows, addressRows, vehicleRows, driverRows, orderRows, itemRows, threadRows, messageRows,
    alertRows, eventRows, relatedRows] = await Promise.all([
    db.select().from(datasetMetadata), db.select().from(customers), db.select().from(sites), db.select().from(addresses),
    db.select().from(vehicles), db.select().from(drivers), db.select().from(orders), db.select().from(orderItems),
    db.select().from(conversations), db.select().from(messages), db.select().from(alerts), db.select().from(operationalEvents),
    db.select().from(relatedRecords),
  ])
  return snapshotFromTables({
    metadata, customers: customerRows, sites: siteRows, addresses: addressRows, vehicles: vehicleRows, drivers: driverRows,
    orders: orderRows, orderItems: itemRows, conversations: threadRows, messages: messageRows, alerts: alertRows,
    operationalEvents: eventRows, relatedRecords: relatedRows,
  })
}
