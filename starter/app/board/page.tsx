"use client"

// The pipeline board (spec .scratch/publishing): every order, one lane per stage from
// unpublished to done. Within a lane: Problem, then Fixed, review it, then
// In progress, then Normal, each by when the order was created. The state is a small tag;
// a normal order carries none.

import { useMemo, useState } from "react"
import { PIPELINE, pipelineColumn } from "@/lib/present/labels"
import { BoardHead, BoardSwitch, byStateThenOrderTime, Lanes, SearchField, type Column } from "../components/columns"
import { Shell } from "../components/shell"
import { useOverview } from "../components/use-overview"

export default function PipelineBoard() {
  const [search, setSearch] = useState("")
  const { overview, error } = useOverview(search)
  const columns: Column[] = useMemo(() => PIPELINE.map(({ key, label }) => ({
    key, label,
    cards: (overview?.visible ?? []).filter((card) => pipelineColumn(card.displayLane) === key).sort(byStateThenOrderTime),
  })), [overview])
  return <Shell section="orders" snapshotAt={overview?.snapshotAt ?? null}><main className="board-page">
    <BoardHead title="Pipeline">
      <SearchField value={search} onChange={setSearch} />
      <BoardSwitch current="pipeline" />
    </BoardHead>
    {error && <p className="queue-error" role="alert">{error}. Check that the local database is running and seeded.</p>}
    <Lanes columns={columns} loading={!overview && !error} />
  </main></Shell>
}
