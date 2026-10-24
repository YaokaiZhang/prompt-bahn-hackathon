// The demo clock (ticket 04). Operator-only, like every API outside /api/phone.
//   GET                          -> ClockView
//   POST { action: "advance" }   -> +15 min
//   POST { action: "next" }      -> to the next due item (409 when nothing is left)
//   POST { action: "reset" }     -> back to the snapshot time, our state cleared
// A move answers with `became`: the due items the clock just passed.

import { NextRequest, NextResponse } from "next/server"
import { becameDue, type Command, type EngineState } from "@/lib/engine/engine"
import { getEngine } from "@/lib/engine/server"
import type { ClockAction, ClockView } from "@/lib/present/types"

export const runtime = "nodejs"

const STEP_MINUTES = 15

const COMMANDS: Record<ClockAction, Command> = {
  advance: { type: "advanceClock", minutes: STEP_MINUTES },
  next: { type: "advanceToNextDue" },
  reset: { type: "reset" },
}

function view(state: EngineState, became: ClockView["became"] = null): ClockView {
  return {
    now: state.now,
    snapshotAt: state.snapshotAt,
    nextDueAt: state.nextDueAt,
    upcoming: state.nextDueAt ? state.dueItems.filter((item) => item.at === state.nextDueAt) : [],
    dueCount: state.dueItems.filter((item) => item.due).length,
    became,
  }
}

export async function GET() {
  const engine = await getEngine()
  return NextResponse.json(view(await engine.state()))
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { action?: string } | null
  const action = body?.action as ClockAction | undefined
  if (!action || !(action in COMMANDS)) return NextResponse.json({ error: "Unknown clock action" }, { status: 400 })
  const engine = await getEngine()
  const from = await engine.clock()
  try {
    const state = await engine.apply(COMMANDS[action])
    return NextResponse.json(view(state, action === "reset" ? [] : becameDue(state, from)))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The clock did not move" }, { status: 409 })
  }
}
