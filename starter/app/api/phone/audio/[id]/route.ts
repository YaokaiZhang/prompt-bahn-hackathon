// Cached speech for a call prompt (ticket 10). Under /api/phone so the Site and
// Driver personas' phone page (ticket 11) can play it as well as the operator.
//   GET /api/phone/audio/<audio id>  -> audio/mpeg, cached for good (the id is a content hash)

import { NextResponse } from "next/server"
import { getAudioStore } from "@/lib/engine/server"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!/^[a-f0-9]{8,64}$/.test(id)) return NextResponse.json({ error: "Not an audio id" }, { status: 400 })
  const audio = await getAudioStore().get(id)
  if (!audio) return NextResponse.json({ error: "No such audio" }, { status: 404 })
  return new Response(Buffer.from(audio.bytes), {
    headers: { "content-type": audio.contentType, "cache-control": "private, max-age=31536000, immutable", "content-length": String(audio.bytes.length) },
  })
}
