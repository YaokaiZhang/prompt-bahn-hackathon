"use client"

// Closing open records from the app (lib/present/closing.ts): one button per record, on
// the CLOSE rule's records in the checks and on the open items. Each close is an effect
// event committed by the operator; CLOCK_EVENT then re-reads the order.

import { useState } from "react"
import type { AttentionKind } from "@/lib/present/types"
import { CLOCK_EVENT } from "./demo-clock"

export type RecordRef = { collection: string; recordId: string }

/** Closes open records on an order (accepts a proof, marks a work item done …). */
export async function closeRecords(orderId: string, records: RecordRef[]): Promise<void> {
  const response = await fetch("/api/records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, records }) })
  const data = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new Error(data?.error ?? "Nothing was closed")
  window.dispatchEvent(new Event(CLOCK_EVENT))
}

/** The open items the operator can close, by kind: the collection the record is in and the verb. */
export const CLOSABLE_ITEM: Partial<Record<AttentionKind, { collection: string; verb: string }>> = {
  alert: { collection: "alerts", verb: "Resolve" },
  owned_alert: { collection: "alerts", verb: "Resolve" },
  work: { collection: "work_items", verb: "Mark done" },
  incident: { collection: "incidents", verb: "Resolve" },
  claim: { collection: "endpoint_claims", verb: "Resolve" },
  proposal: { collection: "agent_proposals", verb: "Close" },
  custody: { collection: "custody_assets", verb: "Mark done" },
  waiting: { collection: "conversations", verb: "Close the thread" },
  conversation: { collection: "conversations", verb: "Close the thread" },
}

export function CloseButton({ orderId, record, verb }: { orderId: string; record: RecordRef; verb: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const close = async () => {
    setBusy(true)
    setError("")
    try { await closeRecords(orderId, [record]) } catch (cause) { setError(cause instanceof Error ? cause.message : "Nothing was closed"); setBusy(false) }
  }
  return <span className="close-record">
    <button type="button" className="btn btn-s btn-quiet" disabled={busy} onClick={() => void close()}>{busy ? "Closing…" : verb}</button>
    {error && <span className="close-error" role="alert">{error}</span>}
  </span>
}
