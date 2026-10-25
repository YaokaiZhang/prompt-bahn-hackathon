"use client"

// The Overview (spec .scratch/publishing): every order, one filter per stage from
// unpublished to done, in the same queue and preview as Needs action.
// Within a stage: Blocked, then Fixed, review it, then In progress, then Normal, each by
// when the order was created. The state is a small tag; a normal order carries none.

import type { BoardCard } from "@/lib/present/types"
import { PIPELINE, pipelineColumn } from "@/lib/present/labels"
import { byStateThenOrderTime } from "../components/columns"
import { QueueBoard, type QueueFilter } from "../components/queue"

const FILTERS: QueueFilter[] = PIPELINE.map(({ key, label }) => ({ key, label, empty: `No order is at ${label.toLowerCase()}.` }))

const place = (card: BoardCard) => pipelineColumn(card.displayLane)

export default function OverviewBoard() {
  return <QueueBoard board="overview" filters={FILTERS} place={place} sort={byStateThenOrderTime} tagged />
}
