import { NextRequest, NextResponse } from "next/server"
import { suggestForThread } from "@/lib/engine/inbox-agent"
import { getEngine, inboxAgentOptions } from "@/lib/engine/server"
import { loadInbox, suggestInput } from "@/lib/present/inbox-load"

export const runtime = "nodejs"

/**
 * GET ?thread=ID: the inbox agent's suggestion for a thread (lib/engine/inbox-agent.ts):
 * a draft reply and, for linked orders, the steps that answer it. It suggests only;
 * nothing is sent or changed. A template stands in without a model key.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("thread")
  if (!id) return NextResponse.json({ error: "Name the thread" }, { status: 400 })
  const engine = await getEngine()
  const thread = (await loadInbox(engine)).view.threads.find((row) => row.id === id)
  if (!thread) return NextResponse.json({ error: "No such thread" }, { status: 404 })
  const suggestion = await suggestForThread(await suggestInput(engine, thread), inboxAgentOptions())
  return NextResponse.json({ suggestion })
}
