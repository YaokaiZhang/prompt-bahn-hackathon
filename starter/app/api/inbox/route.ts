import { NextResponse } from "next/server"
import { eq, or } from "drizzle-orm"
import { db } from "@/lib/db"
import { getEngine } from "@/lib/engine/server"
import { loadInbox } from "@/lib/present/inbox-load"
import { orders } from "@/lib/schema"

export const runtime = "nodejs"

export async function GET() {
  const { threads, messages, view } = await loadInbox(await getEngine())
  return NextResponse.json({ threads, messages, view })
}

type Body = { action?: string; threadId?: string; order?: string; text?: string; suggested?: boolean }

/**
 * The operator acts on a thread (lib/engine/inbox.ts):
 *   { action: "link", threadId, order }     links an order (its reference, CD-…, or its id)
 *   { action: "unlink", threadId, order }   takes back an order the operator linked
 *   { action: "reply", threadId, text, suggested? }   sends a reply to the sender
 * 400 for a malformed request, 404 for an unknown thread or order, 409 when refused.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Body | null
  const threadId = body?.threadId
  if (!body || typeof threadId !== "string" || !["link", "unlink", "reply"].includes(String(body.action))) {
    return NextResponse.json({ error: "Send an action (link, unlink or reply) and a threadId" }, { status: 400 })
  }
  const engine = await getEngine()
  const thread = (await loadInbox(engine)).view.threads.find((row) => row.id === threadId)
  if (!thread) return NextResponse.json({ error: "No such thread" }, { status: 404 })
  try {
    if (body.action === "reply") {
      if (typeof body.text !== "string") return NextResponse.json({ error: "Send the reply's text" }, { status: 400 })
      await engine.apply({ type: "replyThread", threadId, text: body.text, suggested: body.suggested === true })
    } else {
      const wanted = typeof body.order === "string" ? body.order.trim().toUpperCase() : ""
      if (!wanted) return NextResponse.json({ error: "Name the order (CD-…)" }, { status: 400 })
      const [order] = await db.select({ id: orders.id, reference: orders.reference }).from(orders)
        .where(or(eq(orders.reference, wanted), eq(orders.id, wanted.toLowerCase()))).limit(1)
      if (!order) return NextResponse.json({ error: `No order ${body.order!.trim()}` }, { status: 404 })
      if (body.action === "link") {
        if (thread.linked.some((ref) => ref.id === order.id)) return NextResponse.json({ error: `${order.reference} is already linked` }, { status: 409 })
        await engine.apply({ type: "linkThread", threadId, orderId: order.id })
      } else {
        await engine.apply({ type: "unlinkThread", threadId, orderId: order.id })
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nothing changed" }, { status: 409 })
  }
  const { view } = await loadInbox(engine)
  return NextResponse.json({ view })
}
