// Publishing (spec .scratch/publishing). Operator-only, like every API outside /api/phone.
//   POST { action: "confirm", orderId }  -> { publication }: confirms a Solved order's call
//        results; an order not on the market yet is published with the same yes.
//   POST { action: "publish", orderId }  -> { publication }: publishes a Normal (or Solved)
//        order that is not on the market yet.
// A refused action answers 409 with `{ error }`.

import { NextRequest, NextResponse } from "next/server"
import { getEngine } from "@/lib/engine/server"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: unknown; orderId?: unknown } | null
  if ((body?.action !== "confirm" && body?.action !== "publish") || typeof body.orderId !== "string") {
    return NextResponse.json({ error: "Send an action (confirm or publish) and an orderId" }, { status: 400 })
  }
  const engine = await getEngine()
  try {
    const state = await engine.apply(body.action === "confirm" ? { type: "confirmChanges", orderId: body.orderId } : { type: "publish", orderId: body.orderId })
    // The demand filter runs now, so a published order that is not demanding is live for drivers at once.
    await engine.apply({ type: "runPublishing", plans: 0 })
    const publication = state.orders.find((order) => order.id === body.orderId)?.publication ?? null
    return NextResponse.json({ publication })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nothing changed" }, { status: 409 })
  }
}
