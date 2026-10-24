// Calls (ticket 11). Operator-only, like every API outside /api/phone.
//   POST { action: "ringLive", orderId, line: "site" | "driver" }
//     -> { call }: starts the call on that line now, ringing on the Site or Driver phone page
//        instead of the simulated person. Refused (409 + `{ error }`) when a call is already
//        running on the line or nothing is left to ask.

import { NextRequest, NextResponse } from "next/server"
import { getEngine } from "@/lib/engine/server"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: unknown; orderId?: unknown; line?: unknown } | null
  if (body?.action !== "ringLive" || typeof body.orderId !== "string" || (body.line !== "site" && body.line !== "driver")) {
    return NextResponse.json({ error: "Unknown call action" }, { status: 400 })
  }
  const engine = await getEngine()
  try {
    const state = await engine.apply({ type: "startCall", orderId: body.orderId, line: body.line, live: true })
    const call = state.orders.find((order) => order.id === body.orderId)?.calls.filter((row) => row.line === body.line).at(-1) ?? null
    return NextResponse.json({ call })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The call did not start" }, { status: 409 })
  }
}
