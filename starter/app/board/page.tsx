"use client"

// The pipeline board (spec .scratch/publishing): every order, one column per stage from
// unpublished to done. Within a column: Problem, then Fixed, review it, then
// In progress, then Normal, each by when the order was created. The state is a small tag.

import { useMemo, useState } from "react"
import { PIPELINE, pipelineColumn } from "@/lib/present/labels"
import { BoardHead, BoardSwitch, byStateThenOrderTime, Columns, SearchField, type Column } from "../components/columns"
import { Shell } from "../components/shell"
import { useOverview } from "../components/use-overview"

const EMPTY: Record<(typeof PIPELINE)[number]["key"], string> = {
  unpublished: "Every order is published.",
  approval: "No fixed order waits for your review.",
  market: "No order is looking for a driver.",
  assigned: "No order has a driver yet.",
  done: "No order is delivered or cancelled.",
}

export default function PipelineBoard() {
  const [search, setSearch] = useState("")
  const { overview, error } = useOverview(search)
  const columns: Column[] = useMemo(() => PIPELINE.map(({ key, label }) => ({
    key, label, className: `column-${key}`,
    cards: (overview?.visible ?? []).filter((card) => pipelineColumn(card.displayLane) === key).sort(byStateThenOrderTime),
    empty: search ? `No order here matches “${search}”.` : EMPTY[key],
  })), [overview, search])
  return <Shell section="orders" snapshotAt={overview?.snapshotAt ?? null}><main className="board-page">
    <BoardHead title="Pipeline" sub={overview ? <><b>{overview.total}</b> orders from unpublished to done</> : "Loading the snapshot"}>
      <BoardSwitch current="pipeline" />
    </BoardHead>
    <div className="board-tools"><SearchField value={search} onChange={setSearch} /></div>
    {error && <p className="queue-error" role="alert">{error}. Check that the local database is running and seeded.</p>}
    <Columns columns={columns} tagged loading={!overview && !error} />
  </main></Shell>
}
