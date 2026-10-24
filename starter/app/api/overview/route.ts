import { NextRequest, NextResponse } from "next/server"
import { compareUrgency } from "@/lib/engine/checks"
import { getEngine } from "@/lib/engine/server"
import { buildBoardCard } from "@/lib/present/board"
import { LANE_ORDER } from "@/lib/present/labels"
import { loadBoardBundles } from "@/lib/present/load"
import type { BoardCard, Overview, Tone } from "@/lib/present/types"

export const runtime = "nodejs"

const TONE_RANK: Record<Tone, number> = { danger: 0, warn: 1, accent: 2, neutral: 3, ok: 4 }

/** Cards that need a person first, then by the date that decides the next step. */
function laneSort(lane: string) {
  return (a: BoardCard, b: BoardCard): number => {
    const attention = TONE_RANK[a.attentionTone] - TONE_RANK[b.attentionTone]
    if (attention) return attention
    const aDate = a.decisive?.start ?? ""
    const bDate = b.decisive?.start ?? ""
    if (lane === "delivered" || lane === "cancelled") return bDate.localeCompare(aDate) || b.updatedAt.localeCompare(a.updatedAt)
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate)
    if (aDate !== bDate) return aDate ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  }
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? ""
  const [{ snapshotAt, bundles }, engine] = await Promise.all([loadBoardBundles(), getEngine()])
  const state = await engine.state()
  const orders = new Map(state.orders.map((order) => [order.id, order]))
  // The board reads each order with its effect events applied, like the order page (ADR 0002).
  const all = (await engine.overlaidAll(bundles)).map((bundle) => {
    const card = buildBoardCard(bundle)
    const order = orders.get(card.id)
    if (order) {
      const first = order.urgency.reasons[0]
      card.verdict = { group: order.group, reason: order.reason, urgent: order.urgency.urgent, urgency: first?.text ?? null }
    }
    return card
  })
  const counts = Object.fromEntries(LANE_ORDER.map((lane) => [lane, all.filter((card) => card.displayLane === lane).length]))
  const attentionCounts = Object.fromEntries(LANE_ORDER.map((lane) => [lane, all.filter((card) => card.displayLane === lane && card.attention.length > 0).length]))
  const matches = query ? all.filter((card) => [
    card.reference, card.customer, card.vehicle, card.origin, card.destination, card.plate ?? "",
  ].some((field) => field.toLowerCase().includes(query))) : all
  // Lane order within each group; Needs action is ranked by the engine's urgency instead.
  const urgency = (card: BoardCard) => {
    const order = orders.get(card.id)
    return order ? { urgency: order.urgency, reference: order.reference } : null
  }
  const laneOrdered = LANE_ORDER.flatMap((lane) => matches.filter((card) => card.displayLane === lane).sort(laneSort(lane)))
  const needs = laneOrdered.filter((card) => card.verdict?.group === "needs_action")
    .sort((a, b) => { const x = urgency(a); const y = urgency(b); return x && y ? compareUrgency(x, y) : 0 })
  const visible = [...needs, ...laneOrdered.filter((card) => card.verdict?.group !== "needs_action")]
  const body: Overview = { snapshotAt, total: all.length, counts, attentionCounts, visible, query, groupCounts: state.groupCounts, now: state.now }
  return NextResponse.json(body)
}
