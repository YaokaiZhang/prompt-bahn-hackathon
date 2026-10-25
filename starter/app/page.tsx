"use client"

// The board of orders that are not normal (spec .scratch/publishing). Needs action is the
// work: situation cards in the main area. Confirm before publishing and In progress sit in
// a rail beside it. Each is sorted soonest deadline first. Normal and finished orders are
// on the pipeline board.

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { Group } from "@/lib/engine/checks"
import type { ApprovalQueue, BoardCard } from "@/lib/present/types"
import { GROUP_LABEL } from "./components/checks"
import { BoardHead, BoardSwitch, bySoonestDeadline, LaneHead, SearchField } from "./components/columns"
import { useClockVersion } from "./components/demo-clock"
import { BatchApproval } from "./components/proposals"
import { Shell } from "./components/shell"
import { dueText, SituationCard } from "./components/situation"
import { useOverview } from "./components/use-overview"

function Situated({ card, now }: { card: BoardCard; now: string | null }) {
  if (!card.situation) return null
  const urgent = card.verdict?.group === "needs_action" && !!card.verdict.urgent
  return <SituationCard orderId={card.id} situation={card.situation} car={card.vehicle} reference={card.reference}
    due={dueText(card.verdict?.dueAt, now)} urgent={urgent} />
}

/** One In progress order: the car and what the agent is doing, in one link. */
function WorkRow({ card, now }: { card: BoardCard; now: string | null }) {
  const due = dueText(card.verdict?.dueAt, now)
  return <Link className="work-row" href={`/orders/${card.id}`}>
    <span className="work-top"><b>{card.vehicle}</b><span className="work-ref">{card.reference}</span>{due && <span className={`work-due${card.verdict?.urgent ? " is-urgent" : ""}`}>{due}</span>}</span>
    <span className="work-what">{card.situation?.headline ?? card.verdict?.reason}</span>
  </Link>
}

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

  const by = useMemo(() => {
    const of = (group: Group) => (overview?.visible ?? []).filter((card) => card.verdict?.group === group).sort(bySoonestDeadline)
    return { needs: of("needs_action"), solved: of("solved"), progress: of("in_progress") }
  }, [overview])
  const now = overview?.now ?? null
  const loading = !overview && !error
  const waiting = approvals?.waiting.length ?? 0

  return <Shell section="orders" snapshotAt={overview?.snapshotAt ?? null}><main className="board-page">
    <BoardHead title="Not normal">
      <SearchField value={search} onChange={setSearch} />
      <BoardSwitch current="attention" />
    </BoardHead>
    {error && <p className="queue-error" role="alert">{error}. Check that the local database is running and seeded.</p>}
    <div className="triage">
      <section className="triage-main" aria-label={GROUP_LABEL.needs_action}>
        <LaneHead label={GROUP_LABEL.needs_action} count={loading ? null : by.needs.length}>
          {waiting > 0 && <button type="button" className={`btn btn-s ${batch ? "btn-quiet" : "btn-tertiary"} lane-action`} aria-pressed={batch} onClick={() => setBatch((value) => !value)}>
            {batch ? "Close batch approval" : `Approve ${waiting} in batch`}
          </button>}
        </LaneHead>
        {batch && approvals && <section className="board-batch" aria-label="Batch approval"><BatchApproval queue={approvals} onClose={() => setBatch(false)} /></section>}
        {loading ? <ol className="sits" aria-busy="true">{[0, 1, 2, 3].map((key) => <li className="sit-skeleton" key={key} />)}</ol>
          : by.needs.length === 0 ? <p className="lane-empty">{search ? `Nothing here matches “${search}”.` : "Nothing needs you."}</p>
          : <ol className="sits">{by.needs.map((card) => <li key={card.id}><Situated card={card} now={now} /></li>)}</ol>}
      </section>
      <aside className="triage-side">
        <section aria-label={GROUP_LABEL.solved}>
          <LaneHead label={GROUP_LABEL.solved} count={loading ? null : by.solved.length} />
          {by.solved.length > 0 && <ol className="sits sits-side">{by.solved.map((card) => <li key={card.id}><Situated card={card} now={now} /></li>)}</ol>}
        </section>
        <section aria-label={GROUP_LABEL.in_progress}>
          <LaneHead label={GROUP_LABEL.in_progress} count={loading ? null : by.progress.length} />
          {by.progress.length > 0 && <ol className="work-rows">{by.progress.map((card) => <li key={card.id}><WorkRow card={card} now={now} /></li>)}</ol>}
        </section>
      </aside>
    </div>
  </main></Shell>
}
