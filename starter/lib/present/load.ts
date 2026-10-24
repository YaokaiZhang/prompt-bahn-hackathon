// Database access for the projections. The routes call these and hand the
// resulting bundles to the pure builders in `assemble.ts`.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  addresses, alerts, conversations, customers, datasetMetadata, drivers, messages, operationalEvents, orderItems, orders,
  relatedRecords, sites, vehicles,
} from "@/lib/schema"
import { snapshotNames } from "./actors"
import { buildShared, inboxFor, makeBundle, SHARED_COLLECTIONS } from "./assemble"
import type { Bundle, RelatedRow } from "./bundle"
import type { Row } from "./types"

export { makeBundle } from "./assemble"

type OrderRow = typeof orders.$inferSelect
type CustomerRow = typeof customers.$inferSelect
type ItemRow = { item: typeof orderItems.$inferSelect; vehicle: typeof vehicles.$inferSelect }

export const BOARD_COLLECTIONS = [
  "time_windows", "tracking_observations", "work_assignments", "market_offers", "work_items", "agent_proposals",
  "order_endpoint_details", "transport_points", "transport_segments", "incidents", "endpoint_claims", "custody_assets",
  "market_offer_exposures", "custody_reports",
]

export async function loadShared() {
  const [metadata] = await db.select().from(datasetMetadata).limit(1)
  const [driverRows, customerRows, siteRows, addressRows, related] = await Promise.all([
    db.select().from(drivers),
    db.select().from(customers),
    db.select().from(sites),
    db.select().from(addresses),
    db.select({ collection: relatedRecords.collection, id: relatedRecords.id, details: relatedRecords.details }).from(relatedRecords)
      .where(inArray(relatedRecords.collection, [...SHARED_COLLECTIONS, "order_endpoint_details"])),
  ])
  return buildShared({
    snapshotAt: metadata?.snapshotAt ?? null,
    drivers: driverRows, customers: customerRows, sites: siteRows, addresses: addressRows, related,
  })
}

/** Every order with the records the board reads, in one pass over the database. */
export async function loadBoardBundles(): Promise<{ snapshotAt: string | null; bundles: Bundle[] }> {
  const shared = await loadShared()
  const dir = shared.makeDirectory()
  const [orderRows, itemRows, alertRows, threadRows, relatedRows, eventRows] = await Promise.all([
    db.select().from(orders).orderBy(desc(orders.updatedAt), asc(orders.reference)),
    db.select({ item: orderItems, vehicle: vehicles }).from(orderItems).innerJoin(vehicles, eq(orderItems.vehicleId, vehicles.id)),
    db.select().from(alerts),
    db.select().from(conversations),
    db.select().from(relatedRecords).where(inArray(relatedRecords.collection, BOARD_COLLECTIONS)),
    db.select().from(operationalEvents).where(inArray(operationalEvents.command, ["vehicle.picked_up", "vehicle.delivered"])),
  ])
  const group = <T extends { orderId: string | null }>(items: T[]) => {
    const map = new Map<string, T[]>()
    for (const item of items) {
      if (!item.orderId) continue
      const list = map.get(item.orderId) ?? []
      list.push(item)
      map.set(item.orderId, list)
    }
    return map
  }
  const itemsByOrder = group(itemRows.map((row) => ({ orderId: row.item.orderId, row })))
  const alertsByOrder = group(alertRows)
  // A support case can concern two orders. File each thread under the order it
  // was filed on and under every related order, once per order, so the board
  // reads the same conversations as the order record.
  const threadsByOrder = new Map<string, (typeof conversations.$inferSelect)[]>()
  for (const thread of threadRows) {
    const related = Array.isArray(thread.details.related_order_ids) ? thread.details.related_order_ids : []
    const orderIds = new Set([thread.orderId, ...related.filter((value): value is string => typeof value === "string")])
    for (const orderId of orderIds) {
      const list = threadsByOrder.get(orderId) ?? []
      if (!list.some((known) => known.id === thread.id)) list.push(thread)
      threadsByOrder.set(orderId, list)
    }
  }
  for (const list of threadsByOrder.values()) list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  const eventsByOrder = group(eventRows)
  const relatedByOrder = new Map<string, Record<string, RelatedRow[]>>()
  for (const row of relatedRows) {
    if (!row.orderId) continue
    const byCollection = relatedByOrder.get(row.orderId) ?? {}
    ;(byCollection[row.collection] ??= []).push({ id: row.id, details: row.details })
    relatedByOrder.set(row.orderId, byCollection)
  }
  const bundles = orderRows.map((order) => makeBundle({
    shared, dir, order,
    customer: shared.customers.get(order.customerId),
    items: (itemsByOrder.get(order.id) ?? []).map((entry) => entry.row),
    alerts: alertsByOrder.get(order.id) ?? [],
    conversations: threadsByOrder.get(order.id) ?? [],
    messages: [],
    events: eventsByOrder.get(order.id) ?? [],
    related: relatedByOrder.get(order.id) ?? {},
    bundleOrderRefs: {},
  }))
  return { snapshotAt: shared.snapshotAt, bundles }
}

export type OrderLoad = {
  order: OrderRow
  customer: CustomerRow | undefined
  pickup: typeof addresses.$inferSelect | undefined
  delivery: typeof addresses.$inferSelect | undefined
  pickupSite: typeof sites.$inferSelect | null
  deliverySite: typeof sites.$inferSelect | null
  items: ItemRow[]
  alerts: (typeof alerts.$inferSelect)[]
  threads: (typeof conversations.$inferSelect)[]
  messages: (typeof messages.$inferSelect)[]
  events: (typeof operationalEvents.$inferSelect)[]
  related: Record<string, (typeof relatedRecords.$inferSelect)[] | undefined>
  bundleOrderRefs: Record<string, string>
  drivers: (typeof drivers.$inferSelect)[]
  bundle: Bundle
}

/** One order with every linked record, including shared bundle offers and threads filed on related orders. */
export async function loadOrder(id: string): Promise<OrderLoad | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1)
  if (!order) return null
  const shared = await loadShared()
  const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1)
  const [[pickup], [delivery], [pickupSite], [deliverySite]] = await Promise.all([
    db.select().from(addresses).where(eq(addresses.id, order.pickupAddressId)).limit(1),
    db.select().from(addresses).where(eq(addresses.id, order.deliveryAddressId)).limit(1),
    order.pickupSiteId ? db.select().from(sites).where(eq(sites.id, order.pickupSiteId)).limit(1) : Promise.resolve([]),
    order.deliverySiteId ? db.select().from(sites).where(eq(sites.id, order.deliverySiteId)).limit(1) : Promise.resolve([]),
  ])
  const [items, orderAlerts, primaryThreads, linkedThreads, events, records] = await Promise.all([
    db.select({ item: orderItems, vehicle: vehicles }).from(orderItems)
      .innerJoin(vehicles, eq(orderItems.vehicleId, vehicles.id)).where(eq(orderItems.orderId, id)),
    db.select().from(alerts).where(eq(alerts.orderId, id)).orderBy(desc(alerts.triggeredAt)),
    db.select().from(conversations).where(eq(conversations.orderId, id)).orderBy(desc(conversations.updatedAt)),
    db.select().from(conversations).where(sql`${conversations.details} -> 'related_order_ids' @> ${JSON.stringify([id])}::jsonb`),
    db.select().from(operationalEvents).where(eq(operationalEvents.orderId, id)).orderBy(desc(operationalEvents.recordedAt)).limit(50),
    db.select().from(relatedRecords).where(eq(relatedRecords.orderId, id)),
  ])
  // A support case can concern two orders. Show its complete thread from either
  // order detail, while keeping each message's original order attribution.
  const threads = [...new Map([...primaryThreads, ...linkedThreads].map((thread) => [thread.id, thread])).values()]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  const threadIds = threads.map((thread) => thread.id)
  const orderMessages = threadIds.length
    ? await db.select().from(messages).where(inArray(messages.conversationId, threadIds)).orderBy(asc(messages.authoredAt))
    : []
  const related: Record<string, (typeof relatedRecords.$inferSelect)[] | undefined> = Object.groupBy(records, (record) => record.collection)
  // A bundle is one offer covering several orders. Keep one stored offer and
  // surface its membership and shared acceptance on each member order.
  const memberBundles = await db.select().from(relatedRecords).where(and(
    eq(relatedRecords.collection, "market_offers"),
    sql`${relatedRecords.details} -> 'order_ids' @> ${JSON.stringify([id])}::jsonb`,
  ))
  const knownOffers = new Set((related.market_offers ?? []).map((record) => record.id))
  const extraBundles = memberBundles.filter((record) => !knownOffers.has(record.id))
  if (extraBundles.length) related.market_offers = [...(related.market_offers ?? []), ...extraBundles]
  const linkedOrderIds = new Set<string>()
  for (const record of related.market_offers ?? []) {
    if (record.details.type === "BUNDLE" && Array.isArray(record.details.order_ids)) {
      for (const value of record.details.order_ids) if (typeof value === "string") linkedOrderIds.add(value)
    }
  }
  for (const record of related.work_assignments ?? []) {
    const positioning = record.details.positioning
    if (typeof positioning === "object" && positioning && !Array.isArray(positioning)) {
      const previous = (positioning as Row).previous_order_id
      if (typeof previous === "string") linkedOrderIds.add(previous)
    }
  }
  for (const record of related.custody_assets ?? []) {
    if (typeof record.details.related_order_id === "string") linkedOrderIds.add(record.details.related_order_id)
  }
  for (const thread of threads) {
    if (Array.isArray(thread.details.related_order_ids)) for (const value of thread.details.related_order_ids) if (typeof value === "string") linkedOrderIds.add(value)
    if (thread.orderId !== id) linkedOrderIds.add(thread.orderId)
  }
  for (const thread of inboxFor(shared, id)) {
    for (const key of ["candidate_order_ids", "linked_order_ids"]) {
      const values = thread.details[key]
      if (Array.isArray(values)) for (const value of values) if (typeof value === "string") linkedOrderIds.add(value)
    }
  }
  const linkedOrders = linkedOrderIds.size
    ? await db.select({ id: orders.id, reference: orders.reference }).from(orders).where(inArray(orders.id, [...linkedOrderIds])) : []
  const bundleOrderRefs = Object.fromEntries(linkedOrders.map((member) => [member.id, member.reference]))
  const sharedOfferIds = extraBundles.map((record) => record.id)
  const sharedEvents = sharedOfferIds.length ? await db.select().from(operationalEvents).where(and(
    inArray(operationalEvents.targetId, sharedOfferIds),
    eq(operationalEvents.targetType, "market_offer"),
  )) : []
  const visibleEvents = [...new Map([...events, ...sharedEvents].map((event) => [event.id, event])).values()]
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
  const driverIds = [...new Set([
    ...(related.work_assignments ?? []).map((record) => record.details.driver_id),
    ...(related.market_offer_exposures ?? []).map((record) => record.details.driver_id),
  ].filter((value): value is string => typeof value === "string"))]
  const linkedDrivers = driverIds.length ? await db.select().from(drivers).where(inArray(drivers.id, driverIds)) : []
  const dir = shared.makeDirectory(snapshotNames(orderMessages))
  const relatedRows: Record<string, RelatedRow[] | undefined> = Object.fromEntries(
    Object.entries(related).map(([collection, rows]) => [collection, (rows ?? []).map((row) => ({ id: row.id, details: row.details }))]),
  )
  const bundle = makeBundle({
    shared, dir, order, customer, items, alerts: orderAlerts, conversations: threads, messages: orderMessages,
    events: visibleEvents, related: relatedRows, bundleOrderRefs,
  })
  return {
    order, customer, pickup, delivery, pickupSite: pickupSite ?? null, deliverySite: deliverySite ?? null, items,
    alerts: orderAlerts, threads, messages: orderMessages, events: visibleEvents, related, bundleOrderRefs, drivers: linkedDrivers, bundle,
  }
}

/** References for a set of order ids, for links between records. */
export async function orderRefs(ids: Iterable<string>): Promise<Record<string, string>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return {}
  const rows = await db.select({ id: orders.id, reference: orders.reference }).from(orders).where(inArray(orders.id, unique))
  return Object.fromEntries(rows.map((row) => [row.id, row.reference]))
}
