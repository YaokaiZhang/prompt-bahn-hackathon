// A tier-2 turn from the mock phone (ticket 12). Under /api/phone, so the Site and Driver personas reach it.
//   POST { callId, audio: { data: <base64>, format: "wav" }, as? } -> PhoneView after the voice agent answered.
// Only the phone's current call takes a turn, and only while it listens for speech
// (state tier2). A refused turn answers 409 with `{ error }`. A turn takes a few
// seconds: the ear, the audio model and the checker run before this returns.

import { NextRequest, NextResponse } from "next/server"
import type { AudioClip } from "@/lib/engine/voice-agent"
import type { PhonePersona } from "@/lib/engine/phone"
import { getEngine, markPhoneOpen } from "@/lib/engine/server"
import { currentPersona } from "@/lib/persona-server"

export const runtime = "nodejs"
export const maxDuration = 60

const FORMATS: AudioClip["format"][] = ["wav", "mp3", "webm", "ogg", "m4a", "flac"]
/** About a minute of 16 kHz mono WAV, base64. */
const MAX_BASE64 = 2_600_000

async function phoneOf(as: unknown): Promise<PhonePersona | null> {
  const persona = await currentPersona()
  if (persona === "site" || persona === "driver") return persona
  if (persona === "operator") return as === "driver" ? "driver" : "site"
  return null
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { callId?: unknown; audio?: { data?: unknown; format?: unknown }; as?: unknown } | null
  const persona = await phoneOf(body?.as)
  if (!persona) return NextResponse.json({ error: "Choose a persona" }, { status: 401 })
  const data = body?.audio?.data
  const format = body?.audio?.format as AudioClip["format"]
  if (typeof body?.callId !== "string" || typeof data !== "string" || !data || !FORMATS.includes(format)) {
    return NextResponse.json({ error: "Send a callId and a recording" }, { status: 400 })
  }
  if (data.length > MAX_BASE64) return NextResponse.json({ error: "That recording is too long. Keep it under a minute." }, { status: 413 })
  const engine = await getEngine()
  const view = await engine.phone(persona)
  if (view.current?.id !== body.callId) return NextResponse.json({ error: `${body.callId} is not on the ${persona} phone` }, { status: 409 })
  markPhoneOpen(persona)
  try {
    await engine.apply({ type: "voiceTurn", callId: body.callId, audio: { data, format } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The agent could not take that turn" }, { status: 409 })
  }
  markPhoneOpen(persona)
  return NextResponse.json(await engine.phone(persona))
}
