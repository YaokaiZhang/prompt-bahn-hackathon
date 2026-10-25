// The floating agent avatar's status. Operator-only, like every API outside /api/phone.
//   GET -> { working, inProgress, awaitingApproval }: the agent is working while any order is
//          In progress; Solved orders ("Fixed, review it") are its finished work waiting for a yes.

import { NextResponse } from "next/server"
import { getEngine } from "@/lib/engine/server"

export const runtime = "nodejs"

export async function GET() {
  const engine = await getEngine()
  const { groupCounts } = await engine.state()
  return NextResponse.json({ working: groupCounts.in_progress > 0, inProgress: groupCounts.in_progress, awaitingApproval: groupCounts.solved })
}
