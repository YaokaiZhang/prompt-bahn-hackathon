// Proposals (ticket 07). Operator-only, like every API outside /api/phone.
//   GET                                                -> ApprovalQueue: every proposal waiting for a yes
//   POST { action: "approve", proposalId }             -> ApprovalQueue
//   POST { action: "approveBatch", proposalIds }       -> all or nothing
//   POST { action: "editScript", proposalId, script }
//   POST { action: "dismiss", proposalId, note? }
//   POST { action: "instruct", proposalId, text }      -> re-reviews the order (a model call when a key is set)
//   POST { action: "recordAnswer", proposalId, answer } -> a customer's answer on an approved customer contact; proposes the update; re-reviews
//   POST { action: "answerQuestion", proposalId, answer } -> the operator's answer to the agent's question; re-reviews
// A refused action answers 409 with `{ error }`.

import { NextRequest, NextResponse } from "next/server"
import type { Command, EngineState } from "@/lib/engine/engine"
import { getEngine } from "@/lib/engine/server"
import type { ApprovalQueue, ProposalAction } from "@/lib/present/types"

export const runtime = "nodejs"

function queue(state: EngineState): ApprovalQueue {
  const waiting = state.orders.flatMap((order) => order.proposals.filter((proposal) => proposal.status === "proposed"))
  return { now: state.now, waiting }
}

function toCommand(body: ProposalAction): Command | null {
  const text = (value: unknown) => typeof value === "string" ? value : null
  switch (body.action) {
    case "approve": return text(body.proposalId) ? { type: "approve", proposalId: body.proposalId } : null
    case "approveBatch": return Array.isArray(body.proposalIds) && body.proposalIds.every((id) => typeof id === "string") && body.proposalIds.length
      ? { type: "approveBatch", proposalIds: body.proposalIds } : null
    case "editScript": return text(body.proposalId) && text(body.script) !== null ? { type: "editScript", proposalId: body.proposalId, script: body.script } : null
    case "dismiss": return text(body.proposalId) ? { type: "dismiss", proposalId: body.proposalId, note: text(body.note) ?? undefined } : null
    case "instruct": return text(body.proposalId) && text(body.text) !== null ? { type: "instruct", proposalId: body.proposalId, text: body.text } : null
    case "recordAnswer":
    case "answerQuestion": return text(body.proposalId) && text(body.answer) !== null ? { type: body.action, proposalId: body.proposalId, answer: body.answer } : null
    default: return null
  }
}

export async function GET() {
  const engine = await getEngine()
  return NextResponse.json(queue(await engine.state()))
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as ProposalAction | null
  const command = body && typeof body === "object" ? toCommand(body) : null
  if (!command) return NextResponse.json({ error: "Unknown proposal action" }, { status: 400 })
  const engine = await getEngine()
  try {
    return NextResponse.json(queue(await engine.apply(command)))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The proposal did not change" }, { status: 409 })
  }
}
