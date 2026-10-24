// The driver market (spec .scratch/publishing). Under /api/phone, so the Driver persona reaches it.
//   GET -> DriverJobs: every job live for drivers (passed the demand filter, planned when
//          demanding), soonest pickup first, each with the travel planner's suggestion.

import { NextResponse } from "next/server"
import { getEngine } from "@/lib/engine/server"
import { driverJobs } from "@/lib/present/jobs"
import type { DriverJobs } from "@/lib/present/types"
import { currentPersona } from "@/lib/persona-server"

export const runtime = "nodejs"

export async function GET() {
  const persona = await currentPersona()
  if (persona !== "driver" && persona !== "operator") return NextResponse.json({ error: "Only drivers see the job market" }, { status: 403 })
  const engine = await getEngine()
  const state = await engine.state()
  const overlaid = new Map((await engine.overlaidAll(state.orders.map((order) => engine.bundle(order.id)!))).map((bundle) => [bundle.order.id, bundle]))
  const body: DriverJobs = { now: state.now, jobs: driverJobs(state.orders, (orderId) => overlaid.get(orderId) ?? null) }
  return NextResponse.json(body)
}
