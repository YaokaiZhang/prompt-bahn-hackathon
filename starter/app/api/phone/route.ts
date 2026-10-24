// The mock phone (ticket 11). Under /api/phone, so the Site and Driver personas reach it.
//   GET  ?as=site|driver                -> PhoneView: the live call on the phone, the queue, the last call.
//                                          Site and Driver read their own phone; Operator picks one with `as` (default site).
//                                          Polling marks the phone page open (a ringing call rings out only on an open phone).
//   POST { callId, input, as? }         -> PhoneView after the callee's move. `input` is
//                                          { type: "answer" | "decline" | "no_answer" | "hang_up" } or { type: "key", digit }.
//   Tier-2 speech turns go to POST /api/phone/voice (ticket 12).
// A refused move (call queued, ended, wrong turn) answers 409 with `{ error }`.

import { NextRequest, NextResponse } from "next/server"
import type { CalleeInput } from "@/lib/engine/calls"
import type { PhonePersona } from "@/lib/engine/phone"
import { phoneFor } from "@/lib/engine/phone"
import { getEngine, markPhoneOpen } from "@/lib/engine/server"
import { currentPersona } from "@/lib/persona-server"

export const runtime = "nodejs"

async function phoneOf(as: unknown): Promise<PhonePersona | null> {
  const persona = await currentPersona()
  if (persona === "site" || persona === "driver") return persona
  if (persona === "operator") return as === "driver" ? "driver" : "site"
  return null
}

function inputOf(value: unknown): CalleeInput | null {
  if (!value || typeof value !== "object") return null
  const input = value as { type?: unknown; digit?: unknown }
  if (input.type === "answer" || input.type === "decline" || input.type === "no_answer" || input.type === "hang_up") return { type: input.type }
  if (input.type === "key" && typeof input.digit === "string") return { type: "key", digit: input.digit }
  return null
}

export async function GET(request: NextRequest) {
  const persona = await phoneOf(request.nextUrl.searchParams.get("as"))
  if (!persona) return NextResponse.json({ error: "Choose a persona" }, { status: 401 })
  markPhoneOpen(persona)
  return NextResponse.json(await (await getEngine()).phone(persona))
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { callId?: unknown; input?: unknown; as?: unknown } | null
  const persona = await phoneOf(body?.as)
  if (!persona) return NextResponse.json({ error: "Choose a persona" }, { status: 401 })
  const input = inputOf(body?.input)
  if (typeof body?.callId !== "string" || !input) return NextResponse.json({ error: "Send a callId and an input" }, { status: 400 })
  const engine = await getEngine()
  const view = await engine.phone(persona)
  const call = view.current?.id === body.callId ? view.current : null
  if (!call || phoneFor(call.line) !== persona) {
    return NextResponse.json({ error: `${body.callId} is not ringing on the ${persona} phone` }, { status: 409 })
  }
  try {
    await engine.apply({ type: "callEvent", callId: call.id, input })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The call did not take that" }, { status: 409 })
  }
  markPhoneOpen(persona)
  return NextResponse.json(await engine.phone(persona))
}
