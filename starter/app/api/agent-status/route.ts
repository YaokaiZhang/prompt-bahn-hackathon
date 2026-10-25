// The floating agent avatar's status, over the orders the operator highlighted. Operator-only,
// like every API outside /api/phone.
//   GET ?ids=a,b -> AgentStatus: the agent is working while any of these orders is In progress;
//                   Solved ones ("Fixed, review it") are its finished work waiting for a yes.
//                   `orders` lists each known id with its state, In progress first.

import { NextRequest, NextResponse } from "next/server"
import type { Group } from "@/lib/engine/checks"
import { getEngine } from "@/lib/engine/server"
import { buildBoardCard } from "@/lib/present/board"
import { situationFor } from "@/lib/present/situation"

export const runtime = "nodejs"

export type AgentTask = { id: string; reference: string; vehicle: string; route: string; group: Group; text: string }
export type AgentStatus = { working: boolean; inProgress: number; awaitingApproval: number; orders: AgentTask[] }

const RANK: Record<Group, number> = { in_progress: 0, solved: 1, needs_action: 2, normal: 3, done: 4 }

export async function GET(request: NextRequest) {
  const ids = new Set((request.nextUrl.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean))
  const engine = await getEngine()
  const { orders } = await engine.state()
  const tasks = orders.filter((order) => ids.has(order.id)).map((order): AgentTask => {
    const bundle = engine.bundle(order.id)
    const card = bundle ? buildBoardCard(bundle) : null
    return {
      id: order.id,
      reference: order.reference,
      vehicle: card?.vehicle ?? "Vehicle not linked",
      route: card ? `${card.from.city} → ${card.to.city}` : "",
      group: order.group,
      text: situationFor(order)?.headline ?? order.reason,
    }
  }).sort((a, b) => RANK[a.group] - RANK[b.group] || a.reference.localeCompare(b.reference))
  const inProgress = tasks.filter((task) => task.group === "in_progress").length
  const body: AgentStatus = { working: inProgress > 0, inProgress, awaitingApproval: tasks.filter((task) => task.group === "solved").length, orders: tasks }
  return NextResponse.json(body)
}
