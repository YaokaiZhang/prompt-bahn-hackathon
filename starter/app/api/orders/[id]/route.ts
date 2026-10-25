import { NextResponse } from "next/server"
import { getEngine, plainFor } from "@/lib/engine/server"
import { loadOrder } from "@/lib/present/load"
import { laneLabel } from "@/lib/present/labels"
import { buildRecordView } from "@/lib/present/record"
import { situationFor } from "@/lib/present/situation"
import type { OrderChecks } from "@/lib/present/types"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const [loaded, engine] = await Promise.all([loadOrder(id), getEngine()])
  if (!loaded) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  const { order, customer, pickup, delivery, pickupSite, deliverySite, items, alerts, threads, messages, events, related, bundleOrderRefs, drivers, bundle } = loaded
  // The raw records keep their shape for anyone reading the API. `view` is the
  // same information read out with labels, names and grouping for the interface.
  // `checks` is the engine's verdict: group, rule results, planned agent work.
  // The view reads the order with its effect events applied (ADR 0002); the raw records stay as seeded.
  const view = buildRecordView(await engine.overlaid(bundle))
  const state = await engine.state()
  const verdict = state.orders.find((row) => row.id === order.id)
  // Publishing moves an order not on the market yet; the dataset's lane stays as seeded (ADR 0002).
  if (verdict) view.header = { ...view.header, lane: verdict.publication.lane, laneLabel: laneLabel(verdict.publication.lane) }
  const checks: OrderChecks | null = verdict
    ? {
      now: state.now, group: verdict.group, reason: verdict.reason, rules: verdict.rules, planned: verdict.planned, urgency: verdict.urgency,
      review: verdict.review, proposals: verdict.proposals, unreachable: verdict.unreachable,
      calls: verdict.calls, callLines: verdict.callLines, blockedCalls: verdict.blockedCalls,
      effects: verdict.effects, history: verdict.history, publication: verdict.publication,
      plain: null,
    }
    : null
  if (checks && verdict) [checks.plain] = await plainFor([{ situation: situationFor(verdict), group: verdict.group }])
  return NextResponse.json({
    order, customer, pickup, delivery, pickupSite, deliverySite, items, drivers, alerts, conversations: threads, messages, events,
    related, bundleOrderRefs, view, checks,
  })
}
