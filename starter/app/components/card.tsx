"use client"

import Link from "next/link"
import type { KeyboardEvent, MouseEvent } from "react"
import { laneLabel } from "@/lib/present/labels"
import { fmtDateTime, fmtRange, fmtWeekday } from "@/lib/present/time"
import type { Group } from "@/lib/engine/checks"
import type { BoardCard } from "@/lib/present/types"
import { GROUP_LABEL, groupTone } from "./checks"
import { Icon } from "./icons"

/**
 * One order in a queue: the car, then reference and route, then what is wrong in the
 * situation card's own words. A quiet order shows the date that decides its next step
 * instead. `tagged` (the overview) adds the state tag; elsewhere the deadline sits there.
 */
export function QueueCard({ card, current = false, tagged = false, due, onSelect }: { card: BoardCard; current?: boolean; tagged?: boolean; due?: string | null; onSelect?: (id: string) => void }) {
  const verdict = card.verdict
  const loud = verdict && verdict.group !== "normal" && verdict.group !== "done" ? verdict : null
  const why = loud ? card.situation?.headline ?? loud.reason : null
  const tone = loud ? groupTone(loud.group, loud.urgent) : "neutral"
  const icon = loud?.group === "in_progress" ? "waiting" : loud?.group === "solved" ? "check" : "alert"
  const date = card.decisive
  const select = (event: MouseEvent<HTMLAnchorElement> | KeyboardEvent<HTMLAnchorElement>) => {
    if (!onSelect || event.metaKey || event.ctrlKey || event.shiftKey) return
    if (window.matchMedia("(max-width: 900px)").matches) return
    event.preventDefault()
    onSelect(card.id)
  }
  return <Link className="qcard" href={`/orders/${card.id}`} onClick={select} aria-current={current ? "true" : undefined}
    aria-label={`${card.vehicle}, ${card.reference}${loud ? `, ${GROUP_LABEL[loud.group]}` : ""}${why ? `, ${why}` : ""}`}>
    <span className="qcard-top">
      <span className="qcard-car">{card.vehicle}</span>
      {tagged && loud ? <StateTag group={loud.group} urgent={loud.urgent} />
        : due ? <span className={`qcard-due${loud?.urgent ? " is-urgent" : ""}`}>{due}</span> : null}
    </span>
    <span className="qcard-meta">{card.reference} · {card.from.city} → {card.to.city}{!why && date ? <> · <span className="qcard-date">{date.label.toLowerCase()} <b>{dateText(date.start, date.end, date.zone)}</b></span></> : null}</span>
    {why && <span className={`qcard-why tone-${tone}`}><Icon name={icon} size={14} /><span>{why}</span></span>}
  </Link>
}

function dateText(start: string, end: string | null, zone: string | null): string {
  const day = fmtWeekday(start, zone)
  const from = fmtDateTime(start, zone, false).split(" ").pop() ?? ""
  if (!end) return `${day} ${from}`
  const to = fmtDateTime(end, zone, false).split(" ").pop() ?? ""
  return fmtWeekday(end, zone) === day ? `${day} ${from}–${to}` : fmtRange(start, end, zone)
}

/**
 * One order as a compact tile: car, then reference and route. On the overview
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

/** The small state tag on an overview tile: Urgent, Blocked, Fixed, review it or In progress. */
export function StateTag({ group, urgent = false }: { group: Group; urgent?: boolean }) {
  const label = urgent && group === "needs_action" ? "Urgent" : GROUP_LABEL[group]
  return <span className={`state-tag state-${group} tone-${groupTone(group, urgent)}`} title={GROUP_LABEL[group]}>{label}</span>
}
