"use client"

// The board of orders that are not normal (spec .scratch/publishing): one column per
// state, soonest deadline first. Normal and finished orders are on the pipeline board.

import { useEffect, useMemo, useState } from "react"
import type { Group } from "@/lib/engine/checks"
import type { ApprovalQueue } from "@/lib/present/types"
import { GROUP_LABEL } from "./components/checks"
import { BoardHead, BoardSwitch, bySoonestDeadline, Columns, SearchField, type Column } from "./components/columns"
import { useClockVersion } from "./components/demo-clock"
import { BatchApproval } from "./components/proposals"
import { Shell } from "./components/shell"
import { useOverview } from "./components/use-overview"

const STATES: { group: Group; empty: string }[] = [
  { group: "needs_action", empty: "No problem right now." },
  { group: "solved", empty: "No fixed order waits for your review." },
  { group: "in_progress", empty: "No agent work is planned or running." },
]

export default function NotNormalBoard() {
  const [search, setSearch] = useState("")
  const { overview, error } = useOverview(search)
  const clockVersion = useClockVersion()
  // Proposals waiting for a yes, across orders, for batch approval (ticket 07).
  const [approvals, setApprovals] = useState<ApprovalQueue | null>(null)
  const [batch, setBatch] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/proposals", { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<ApprovalQueue> : null)
      .then((data) => { if (data) setApprovals(data) })
      .catch(() => {})
    return () => controller.abort()
  }, [clockVersion])

  const columns: Column[] = useMemo(() => STATES.map(({ group, empty }) => ({
    key: group, label: GROUP_LABEL[group], className: `column-${group}`,
    cards: (overview?.visible ?? []).filter((card) => card.verdict?.group === group).sort(bySoonestDeadline),
    empty: search ? `No order here matches “${search}”.` : empty,
  })), [overview, search])

  const counts = overview?.groupCounts
  return <Shell section="orders" snapshotAt={overview?.snapshotAt ?? null}><main className="board-page">
    <BoardHead title="Not normal" sub={overview && counts
      ? <><b>{counts.needs_action + counts.solved + counts.in_progress}</b> of <b>{overview.total}</b> orders are not normal · <b>{counts.normal}</b> normal and <b>{counts.done}</b> finished are on the pipeline</>
      : "Loading the snapshot"}>
      <BoardSwitch current="attention" />
    </BoardHead>
    <div className="board-tools">
      <SearchField value={search} onChange={setSearch} />
      {approvals && approvals.waiting.length > 0 && <div className="queue-batch">
        <button type="button" className={`btn btn-s ${batch ? "btn-tertiary" : "btn-primary"}`} aria-pressed={batch} onClick={() => setBatch((value) => !value)}>
          {batch ? "Close batch approval" : "Approve in batch"}
        </button>
        <span><b>{approvals.waiting.length}</b> {approvals.waiting.length === 1 ? "proposal waits" : "proposals wait"} for your yes</span>
      </div>}
    </div>
    {batch && approvals && <section className="board-batch" aria-label="Batch approval"><BatchApproval queue={approvals} onClose={() => setBatch(false)} /></section>}
    {error && <p className="queue-error" role="alert">{error}. Check that the local database is running and seeded.</p>}
    <Columns columns={columns} loading={!overview && !error} />
  </main></Shell>
}
