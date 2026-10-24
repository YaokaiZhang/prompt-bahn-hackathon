// Pure bundle assembly from snapshot rows. No database access here, so the engine
// can build the same per-order bundles from the dataset files (tests) or from the
// starter's tables (app). `load.ts` fetches rows and hands them to these builders.

import type { addresses, alerts, conversations, customers, drivers, messages, operationalEvents, orderItems, orders, relatedRecords, sites, vehicles } from "@/lib/schema"
import type { SnapshotTables } from "@/lib/snapshot/tables"
import { Directory, snapshotNames } from "./actors"
import type { Bundle, PlaceRow, RelatedRow, SiteRow } from "./bundle"
import type { Row } from "./types"

type OrderRow = typeof orders.$inferSelect
type CustomerRow = typeof customers.$inferSelect
type ItemRow = { item: typeof orderItems.$inferSelect; vehicle: typeof vehicles.$inferSelect }

const iso = (value: Date | string | null | undefined): string => value instanceof Date ? value.toISOString() : value ? String(value) : ""

export const SHARED_COLLECTIONS = ["operators", "agents", "support_inbox_threads"]

export type SharedInput = {
  snapshotAt: Date | null
  drivers: (typeof drivers.$inferSelect)[]
  customers: CustomerRow[]
  sites: (typeof sites.$inferSelect)[]
  addresses: (typeof addresses.$inferSelect)[]
  /** Rows of SHARED_COLLECTIONS and order_endpoint_details; other collections are ignored. */
  related: Pick<typeof relatedRecords.$inferSelect, "collection" | "id" | "details">[]
}

export function buildShared(input: SharedInput) {
  const places = new Map<string, PlaceRow>(input.addresses.map((row) => [row.id, {
    id: row.id, name: row.name, city: row.city, country: row.country, managedSiteId: row.managedSiteId, details: row.details,
  }]))
  const siteMap = new Map<string, SiteRow>(input.sites.map((row) => [row.id, {
    id: row.id, name: row.name, city: row.city, country: row.country, kind: row.kind, details: row.details,
  }]))
  const operators = input.related.filter((row) => row.collection === "operators").map((row) => ({ id: row.id, ...row.details }))
  const agents = input.related.filter((row) => row.collection === "agents").map((row) => ({ id: row.id, ...row.details }))
  const endpointRows = input.related.filter((row) => row.collection === "order_endpoint_details")
  const inbox: RelatedRow[] = input.related.filter((row) => row.collection === "support_inbox_threads").map((row) => ({ id: row.id, details: row.details }))
  const { drivers: driverRows, customers: customerRows, sites: siteRows } = input
  return {
    snapshotAt: input.snapshotAt ? input.snapshotAt.toISOString() : null,
    customers: new Map<string, CustomerRow>(customerRows.map((row) => [row.id, row])),
    places,
    sites: siteMap,
    inbox,
    makeDirectory: (snapshots?: Map<string, string>) => new Directory({
      drivers: driverRows.map((row) => ({ id: row.id, displayName: row.displayName, homeCity: row.homeCity, homeCountry: row.homeCountry })),
      operators: operators as Row[],
      agents: agents as Row[],
      customers: customerRows.map((row) => ({ id: row.id, name: row.name })),
      sites: siteRows.map((row) => ({ id: row.id, name: row.name })),
      endpointDetails: endpointRows.map((row) => ({ id: row.id, ...row.details })),
      snapshots,
    }),
  }
}

export type Shared = ReturnType<typeof buildShared>

export function inboxFor(shared: Shared, orderId: string): RelatedRow[] {
  return shared.inbox.filter((thread) => {
    const candidates = Array.isArray(thread.details.candidate_order_ids) ? thread.details.candidate_order_ids : []
    const linked = Array.isArray(thread.details.linked_order_ids) ? thread.details.linked_order_ids : []
    return candidates.includes(orderId) || linked.includes(orderId)
  })
}

export function makeBundle(input: {
  shared: Shared
  dir: Directory
  order: OrderRow
  customer: CustomerRow | undefined
  items: ItemRow[]
  alerts: (typeof alerts.$inferSelect)[]
  conversations: (typeof conversations.$inferSelect)[]
  messages: (typeof messages.$inferSelect)[]
  events: (typeof operationalEvents.$inferSelect)[]
  related: Record<string, RelatedRow[] | undefined>
  bundleOrderRefs: Record<string, string>
}): Bundle {
  const { shared, order } = input
  return {
    snapshotAt: shared.snapshotAt,
    order: {
      id: order.id, reference: order.reference, lane: order.displayLane, status: order.status, routeKind: order.routeKind,
      createdAt: iso(order.createdAt), updatedAt: iso(order.updatedAt), details: order.details,
      pickupAddressId: order.pickupAddressId, deliveryAddressId: order.deliveryAddressId,
      pickupSiteId: order.pickupSiteId, deliverySiteId: order.deliverySiteId,
    },
    customer: {
      id: input.customer?.id ?? order.customerId, name: input.customer?.name ?? "Unknown customer",
      tier: input.customer?.accountTier ?? null, country: input.customer?.country ?? null,
    },
    items: input.items.map(({ item, vehicle }) => ({
      id: item.id, role: item.role, details: item.details,
      vehicle: { id: vehicle.id, make: vehicle.make, model: vehicle.model, year: vehicle.modelYear, fuel: vehicle.fuel, registration: vehicle.registration, vin: vehicle.syntheticVin },
    })),
    alerts: input.alerts.map((alert) => ({
      id: alert.id, status: alert.status, severity: alert.severity, signal: alert.signal, summary: alert.summary,
      triggeredAt: iso(alert.triggeredAt), details: alert.details,
    })),
    conversations: input.conversations.map((thread) => ({
      id: thread.id, orderId: thread.orderId, status: thread.status, category: thread.category, channel: thread.channel,
      updatedAt: iso(thread.updatedAt), details: thread.details,
    })),
    messages: input.messages.map((message) => ({
      id: message.id, orderId: message.orderId, conversationId: message.conversationId, authorType: message.authorType,
      body: message.body, authoredAt: iso(message.authoredAt), details: message.details,
    })),
    events: input.events.map((event) => ({
      id: event.id, orderId: event.orderId, command: event.command, targetType: event.targetType, targetId: event.targetId,
      recordedAt: iso(event.recordedAt), details: event.details,
    })),
    related: input.related,
    places: shared.places,
    sites: shared.sites,
    dir: input.dir,
    inboxThreads: inboxFor(shared, order.id),
    bundleOrderRefs: input.bundleOrderRefs,
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K | null | undefined): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    if (k == null) continue
    const list = map.get(k) ?? []
    list.push(item)
    map.set(k, list)
  }
  return map
}

const includesId = (value: unknown, id: string): boolean => Array.isArray(value) && value.includes(id)
const time = (value: Date): number => value.getTime()

/**
 * Every order's complete bundle, as `loadOrder` builds it for one order: linked
 * threads and their messages, shared bundle offers and their events, and the
 * references of related orders. Unlike `loadOrder`, events are not capped at 50.
 * Bundles come back sorted by order reference.
 */
export function assembleOrderBundles(tables: SnapshotTables): Bundle[] {
  const shared = buildShared({
    snapshotAt: tables.metadata[0]?.snapshotAt ?? null,
    drivers: tables.drivers, customers: tables.customers, sites: tables.sites, addresses: tables.addresses,
    related: tables.relatedRecords,
  })
  const vehicles = new Map(tables.vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const references = new Map(tables.orders.map((order) => [order.id, order.reference]))
  const itemsByOrder = groupBy(tables.orderItems, (item) => item.orderId)
  const alertsByOrder = groupBy(tables.alerts, (alert) => alert.orderId)
  const threadsByOrder = groupBy(tables.conversations, (thread) => thread.orderId)
  const messagesByThread = groupBy(tables.messages, (message) => message.conversationId)
  const eventsByOrder = groupBy(tables.operationalEvents, (event) => event.orderId)
  const relatedByOrder = groupBy(tables.relatedRecords, (record) => record.orderId)
  const offers = tables.relatedRecords.filter((record) => record.collection === "market_offers")
  const offerEvents = groupBy(tables.operationalEvents.filter((event) => event.targetType === "market_offer"), (event) => event.targetId)

  return [...tables.orders].sort((a, b) => a.reference.localeCompare(b.reference)).map((order) => {
    const id = order.id
    const linkedThreads = tables.conversations.filter((thread) => includesId(thread.details.related_order_ids, id))
    const threads = [...new Map([...(threadsByOrder.get(id) ?? []), ...linkedThreads].map((thread) => [thread.id, thread])).values()]
      .sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
    const orderMessages = threads.flatMap((thread) => messagesByThread.get(thread.id) ?? [])
      .sort((a, b) => time(a.authoredAt) - time(b.authoredAt))

    const related: Record<string, (typeof relatedRecords.$inferSelect)[] | undefined> = {}
    for (const record of relatedByOrder.get(id) ?? []) (related[record.collection] ??= []).push(record)
    // A bundle is one offer covering several orders: surface it on each member order.
    const knownOffers = new Set((related.market_offers ?? []).map((record) => record.id))
    const extraBundles = offers.filter((record) => includesId(record.details.order_ids, id) && !knownOffers.has(record.id))
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
    const bundleOrderRefs: Record<string, string> = {}
    for (const linked of linkedOrderIds) {
      const reference = references.get(linked)
      if (reference) bundleOrderRefs[linked] = reference
    }

    const sharedEvents = extraBundles.flatMap((record) => offerEvents.get(record.id) ?? [])
    const events = [...new Map([...(eventsByOrder.get(id) ?? []), ...sharedEvents].map((event) => [event.id, event])).values()]
      .sort((a, b) => time(b.recordedAt) - time(a.recordedAt))
    const items: ItemRow[] = (itemsByOrder.get(id) ?? []).flatMap((item) => {
      const vehicle = vehicles.get(item.vehicleId)
      return vehicle ? [{ item, vehicle }] : []
    })

    return makeBundle({
      shared, dir: shared.makeDirectory(snapshotNames(orderMessages)), order,
      customer: shared.customers.get(order.customerId),
      items,
      alerts: [...(alertsByOrder.get(id) ?? [])].sort((a, b) => time(b.triggeredAt) - time(a.triggeredAt)),
      conversations: threads, messages: orderMessages, events,
      related: Object.fromEntries(Object.entries(related).map(([collection, records]) => [
        collection, (records ?? []).map((record) => ({ id: record.id, details: record.details })),
      ])),
      bundleOrderRefs,
    })
  })
}
