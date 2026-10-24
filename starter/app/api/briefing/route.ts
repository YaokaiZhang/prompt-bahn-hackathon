// The Briefing inbox (ticket 13). Operator-only, like every API outside /api/phone.
//   GET                               -> BriefingView, after delivering anything due
//                                        (the 09:00 digest at the start; pushes for orders that turned urgent)
//   POST { action: "read", ids? }     -> marks items read (all when ids is absent)

import { NextRequest, NextResponse } from "next/server"
import type { EngineState } from "@/lib/engine/engine"
import { getEngine } from "@/lib/engine/server"
import type { BriefingView } from "@/lib/present/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function view(state: EngineState): BriefingView {
  return { now: state.now, snapshotAt: state.snapshotAt, items: state.briefing.items, unread: state.briefing.unread, groupCounts: state.groupCounts }
}

export async function GET() {
  const engine = await getEngine()
  return NextResponse.json(view(await engine.apply({ type: "deliverBriefing" })))
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: string; ids?: unknown } | null
  if (body?.action !== "read") return NextResponse.json({ error: "Unknown briefing action" }, { status: 400 })
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : undefined
  const engine = await getEngine()
  return NextResponse.json(view(await engine.apply({ type: "markBriefingRead", ids })))
}
