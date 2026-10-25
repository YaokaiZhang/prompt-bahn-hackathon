"use client"

import Link from "next/link"
import { laneLabel } from "@/lib/present/labels"
import type { Group } from "@/lib/engine/checks"
import type { BoardCard } from "@/lib/present/types"
import { GROUP_LABEL, groupTone } from "./checks"

/**
 * One order as a compact tile: car, then reference and route. On the pipeline board
 * (`tagged`, the column is the stage) a small state tag shows when the order is not
 * normal; quiet orders carry no tag. Elsewhere (entity pages) the stage shows instead.
 */
export function OrderTile({ card, tagged = false }: { card: BoardCard; tagged?: boolean }) {
  const verdict = card.verdict
  const tag = tagged && verdict && verdict.group !== "normal" && verdict.group !== "done" ? verdict : null
  return <Link className="tile" href={`/orders/${card.id}`}
    aria-label={`${card.vehicle}, ${card.reference}, ${tag ? GROUP_LABEL[tag.group] : laneLabel(card.displayLane)}`}>
    <span className="tile-top">
      <span className="tile-car">{card.vehicle}</span>
      {tag && <StateTag group={tag.group} urgent={tag.urgent} />}
      {!tagged && <span className="tile-stage"><span className={`stage-dot stage-${card.displayLane}`} />{laneLabel(card.displayLane)}</span>}
    </span>
    <span className="tile-meta">{card.reference} · {card.from.city} → {card.to.city}</span>
  </Link>
}

/** The small state tag on a pipeline tile: Urgent, Problem, Fixed, review it or In progress. */
export function StateTag({ group, urgent = false }: { group: Group; urgent?: boolean }) {
  const label = urgent && group === "needs_action" ? "Urgent" : GROUP_LABEL[group]
  return <span className={`state-tag state-${group} tone-${groupTone(group, urgent)}`} title={GROUP_LABEL[group]}>{label}</span>
}
