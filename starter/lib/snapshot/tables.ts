// The snapshot as table rows: the same shape whether it was read from the dataset
// files or selected from the starter's tables. The seed inserts these rows, and the
// bundle assembler reads them, so both paths share one mapping.

import type {
  addresses, alerts, conversations, customers, datasetMetadata, drivers, messages, operationalEvents, orderItems, orders,
  relatedRecords, sites, vehicles,
} from "../schema"

export type SourceRow = Record<string, unknown> & { id: string; order_id?: string }

export type Manifest = { snapshot_at: string; release_status: string; tables: Record<string, number> }

export type SnapshotTables = {
  metadata: (typeof datasetMetadata.$inferSelect)[]
  customers: (typeof customers.$inferSelect)[]
  sites: (typeof sites.$inferSelect)[]
  addresses: (typeof addresses.$inferSelect)[]
  vehicles: (typeof vehicles.$inferSelect)[]
  drivers: (typeof drivers.$inferSelect)[]
  orders: (typeof orders.$inferSelect)[]
  orderItems: (typeof orderItems.$inferSelect)[]
  conversations: (typeof conversations.$inferSelect)[]
  messages: (typeof messages.$inferSelect)[]
  alerts: (typeof alerts.$inferSelect)[]
  operationalEvents: (typeof operationalEvents.$inferSelect)[]
  relatedRecords: (typeof relatedRecords.$inferSelect)[]
}

/** Collections with their own table. Every other collection is stored in related_records. */
const CORE = new Set([
  "customers", "sites", "addresses", "vehicles", "drivers", "orders", "order_items",
  "conversations", "messages", "alerts", "operational_events",
])

function value(row: SourceRow, key: string): string {
  const result = row[key]
  if (typeof result !== "string") throw new Error(`${row.id}.${key} must be a string`)
  return result
}

function optionalValue(row: SourceRow, key: string): string | null {
  if (row[key] == null) return null
  return value(row, key)
}

function date(row: SourceRow, key: string): Date {
  const parsed = new Date(value(row, key))
  if (Number.isNaN(parsed.getTime())) throw new Error(`${row.id}.${key} is not a date`)
  return parsed
}

function missingPlan(row: SourceRow): never {
  throw new Error(`${row.id} links to a missing transport plan`)
}

/** Maps the dataset's collections onto the starter's tables. */
export function tablesFromSource(manifest: Manifest, source: Map<string, SourceRow[]>): SnapshotTables {
  const rows = (name: string): SourceRow[] => source.get(name) ?? []
  const planOrder = new Map(rows("transport_plans").map((plan) => [plan.id, value(plan, "order_id")]))
  const related: SnapshotTables["relatedRecords"] = []
  for (const [collection, collectionRows] of source) {
    if (CORE.has(collection)) continue
    for (const r of collectionRows) {
      related.push({
        collection, id: r.id,
        orderId: r.order_id ?? (
          collection === "transport_points" || collection === "transport_segments"
            ? planOrder.get(value(r, "plan_id")) ?? missingPlan(r)
            : null
        ),
        details: r,
      })
    }
  }
  return {
    metadata: [{
      id: "current", snapshotAt: new Date(manifest.snapshot_at),
      releaseStatus: manifest.release_status, details: manifest,
    }],
    customers: rows("customers").map((r) => ({
      id: r.id, name: value(r, "name"), country: value(r, "country"),
      accountTier: value(r, "account_tier"), importBuyer: r.import_buyer === true,
    })),
    sites: rows("sites").map((r) => ({
      id: r.id, customerId: r.customer_id ? value(r, "customer_id") : null,
      name: value(r, "name"), city: value(r, "city"), country: value(r, "country"),
      kind: value(r, "kind"), details: r,
    })),
    addresses: rows("addresses").map((r) => ({
      id: r.id, managedSiteId: r.managed_site_id ? value(r, "managed_site_id") : null,
      orderId: r.order_id ? value(r, "order_id") : null,
      name: value(r, "name"), city: value(r, "city"), country: value(r, "country"), details: r,
    })),
    vehicles: rows("vehicles").map((r) => ({
      id: r.id, make: value(r, "make"), model: value(r, "model"),
      modelYear: Number(r.model_year), fuel: value(r, "fuel"), registration: optionalValue(r, "registration"),
      syntheticVin: optionalValue(r, "synthetic_vin"),
    })),
    drivers: rows("drivers").map((r) => ({
      id: r.id, displayName: value(r, "display_name"), homeCity: value(r, "home_city"),
      homeCountry: value(r, "home_country"), details: r,
    })),
    orders: rows("orders").map((r) => ({
      id: r.id, reference: value(r, "reference"), customerId: value(r, "customer_id"),
      pickupSiteId: r.pickup_site_id ? value(r, "pickup_site_id") : null,
      deliverySiteId: r.delivery_site_id ? value(r, "delivery_site_id") : null,
      pickupAddressId: value(r, "pickup_address_id"), deliveryAddressId: value(r, "delivery_address_id"),
      displayLane: value(r, "display_lane"), status: value(r, "status"),
      routeKind: value(r, "route_kind"), createdAt: date(r, "created_at"),
      updatedAt: date(r, "updated_at"), details: r,
    })),
    orderItems: rows("order_items").map((r) => ({
      id: r.id, orderId: value(r, "order_id"), vehicleId: value(r, "vehicle_id"),
      role: value(r, "role"), details: r,
    })),
    conversations: rows("conversations").map((r) => ({
      id: r.id, orderId: value(r, "order_id"), category: value(r, "category"),
      channel: value(r, "channel"), status: value(r, "status"),
      updatedAt: date(r, "updated_at"), details: r,
    })),
    messages: rows("messages").map((r) => ({
      id: r.id, orderId: value(r, "order_id"), conversationId: value(r, "conversation_id"),
      authorType: value(r, "author_type"), body: value(r, "body"),
      authoredAt: date(r, "authored_at"), details: r,
    })),
    alerts: rows("alerts").map((r) => ({
      id: r.id, orderId: value(r, "order_id"), severity: value(r, "severity"),
      signal: value(r, "signal"), status: value(r, "status"),
      summary: value(r, "summary"), triggeredAt: date(r, "triggered_at"), details: r,
    })),
    operationalEvents: rows("operational_events").map((r) => ({
      id: r.id, orderId: value(r, "order_id"), command: value(r, "command"),
      targetType: value(r, "target_type"), targetId: value(r, "target_id"),
      recordedAt: date(r, "recorded_at"), details: r,
    })),
    relatedRecords: related,
  }
}
