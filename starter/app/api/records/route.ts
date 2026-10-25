// Closing open records (lib/present/closing.ts). Operator-only, like every API outside /api/phone.
//   POST { orderId, records: [{ collection, recordId }] } -> { ok: true }: closes each record
//        (accepts a proof, marks a work item done, resolves an alert …) as a record_closed effect.
// A refused close answers 409 with `{ error }`; nothing is written then.

import { NextRequest, NextResponse } from "next/server"
import { getEngine } from "@/lib/engine/server"

export const runtime = "nodejs"

type Body = { orderId?: unknown; records?: unknown }

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Body | null
  const records = Array.isArray(body?.records) ? body.records : []
  const valid = records.length > 0 && records.every((record: unknown) => {
    const row = record as { collection?: unknown; recordId?: unknown } | null
    return typeof row?.collection === "string" && typeof row.recordId === "string"
  })
  if (typeof body?.orderId !== "string" || !valid) {
    return NextResponse.json({ error: "Send an orderId and the records to close ({ collection, recordId })" }, { status: 400 })
  }
  const engine = await getEngine()
  try {
    await engine.apply({ type: "closeRecords", orderId: body.orderId, records: records as { collection: string; recordId: string }[] })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nothing changed" }, { status: 409 })
  }
}
