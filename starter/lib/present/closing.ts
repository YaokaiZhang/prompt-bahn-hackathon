// Closing an open record (the `record_closed` effect, lib/engine/effects.ts): what the
// operator can mark done on an order, the words for it, and what it writes. The snapshot
// is never edited (ADR 0002): the change is an effect event laid over the record.
//
// Pure, and only type imports, so the board and the order page can run it in the browser too.

import type { Row } from "./types"

export type ClosableCollection =
  | "proofs" | "documents" | "endpoint_claims" | "alerts" | "work_items" | "incidents"
  | "agent_proposals" | "custody_assets" | "work_assignments" | "conversations"

type Closing = {
  /** Whether the record is still open, from its fields (alerts and conversations: `status` is on the row). */
  open: (details: Row, status: string | null) => boolean
  /** The button: what the operator does. */
  verb: (details: Row, status: string | null) => string
  /** The history: what happened to it ("accepted", "marked done"). */
  done: (details: Row, status: string | null) => string
  /** The fields it writes, at `at`. */
  change: (details: Row, status: string | null, at: string) => Row
}

const s = (value: unknown) => (typeof value === "string" && value ? value : null)
const OPEN_WORK = new Set(["OPEN", "NEEDS_EXTERNAL_INPUT", "IN_PROGRESS", "WAITING"])
const OPEN_PROPOSAL = new Set(["PENDING_REVIEW", "APPROVED_AWAITING_EXECUTION", "FAILED"])
const CLOSED_BY = { closed_by: "operator", closed_source: "CONTROL_ROOM_EFFECT" }

export const CLOSING: Record<ClosableCollection, Closing> = {
  proofs: {
    open: (row) => ["REQUIRED", "SUBMITTED", "REJECTED"].includes(String(row.status)),
    // A submission is accepted; a requirement with nothing accepted is waived.
    verb: (row) => row.status === "SUBMITTED" ? "Accept" : "Waive",
    done: (row) => row.status === "SUBMITTED" ? "accepted" : "waived",
    change: (row, _status, at) => row.status === "SUBMITTED"
      ? { status: "APPROVED", reviewed_at: at, reviewed_by: "operator", ...CLOSED_BY }
      : { status: "WAIVED", waived_at: at, waived_by: "operator", ...CLOSED_BY },
  },
  documents: {
    open: (row) => row.required === true && ["MISSING", "REQUESTED"].includes(String(row.status)),
    verb: () => "Mark received",
    done: () => "marked received",
    change: (_row, _status, at) => ({ status: "VERIFIED", verified_at: at, ...CLOSED_BY }),
  },
  endpoint_claims: {
    open: (row) => row.resolution_status === "OPEN",
    verb: () => "Resolve",
    done: () => "resolved",
    change: (_row, _status, at) => ({ resolution_status: "RESOLVED_BY_OPERATOR", resolved_at: at, ...CLOSED_BY }),
  },
  alerts: {
    open: (_row, status) => status === "OPEN" || status === "ACKNOWLEDGED",
    verb: () => "Resolve",
    done: () => "resolved",
    change: (_row, _status, at) => ({ status: "RESOLVED", resolved_at: at, ...CLOSED_BY }),
  },
  work_items: {
    open: (row) => OPEN_WORK.has(String(row.status)),
    verb: () => "Mark done",
    done: () => "marked done",
    change: (_row, _status, at) => ({ status: "DONE", closed_at: at, outcome: "Closed by the operator", ...CLOSED_BY }),
  },
  incidents: {
    open: (row) => !s(row.resolved_at),
    verb: () => "Resolve",
    done: () => "resolved",
    change: (_row, _status, at) => ({ resolved_at: at, ...CLOSED_BY }),
  },
  agent_proposals: {
    open: (row) => OPEN_PROPOSAL.has(String(row.status)),
    verb: () => "Close",
    done: () => "closed",
    change: (_row, _status, at) => ({ status: "CLOSED_BY_OPERATOR", closed_at: at, ...CLOSED_BY }),
  },
  custody_assets: {
    open: (row) => !!s(row.next_action),
    verb: () => "Mark done",
    done: () => "follow-up marked done",
    change: (_row, _status, at) => ({ next_action: null, followup_closed_at: at, ...CLOSED_BY }),
  },
  work_assignments: {
    open: (row) => row.status === "ASSIGNED" || row.status === "IN_PROGRESS",
    verb: () => "Mark complete",
    done: () => "marked complete",
    change: (_row, _status, at) => ({ status: "COMPLETED", completed_at: at, ...CLOSED_BY }),
  },
  conversations: {
    open: (_row, status) => status === "OPEN",
    verb: () => "Close the thread",
    done: () => "closed",
    change: (_row, _status, at) => ({ status: "CLOSED", closed_at: at, ...CLOSED_BY }),
  },
}

export const isClosable = (collection: string): collection is ClosableCollection => Object.hasOwn(CLOSING, collection)

/** The fields a close changes, kept on the row as its earlier version. */
export const CLOSING_FIELDS = ["status", "resolution_status", "resolved_at", "next_action", "closed_at", "reviewed_at", "reviewed_by"]
