"use client"

import Link from "next/link"
import type { KeyboardEvent, MouseEvent } from "react"
import { laneLabel } from "@/lib/present/labels"
import { fmtDateTime, fmtRange, fmtWeekday } from "@/lib/present/time"
import type { BoardCard } from "@/lib/present/types"
import { groupTone } from "./checks"
import { Icon } from "./icons"

/** One order in a queue: car, stage, reference, customer, route, the date that decides the next step, and why it needs a person. */
export function OrderCard({ card, current = false, onSelect }: { card: BoardCard; current?: boolean; onSelect?: (id: string) => void }) {
  // On the home queue the engine's verdict says why; elsewhere the starter's open items do.
  const verdict = card.verdict
  const why = verdict
    ? { tone: groupTone(verdict.group, verdict.urgent), short: verdict.group === "needs_action" && verdict.urgent ? `Urgent · ${verdict.reason}` : verdict.reason }
    : card.attention[0]
  const more = verdict ? 0 : card.attention.length - 1
  const icon = !verdict || verdict.group === "needs_action" ? "alert" : verdict.group === "in_progress" ? "waiting" : "check"
  const date = card.decisive
  const select = (event: MouseEvent<HTMLAnchorElement> | KeyboardEvent<HTMLAnchorElement>) => {
    if (!onSelect || event.metaKey || event.ctrlKey || event.shiftKey) return
    if (window.matchMedia("(max-width: 900px)").matches) return
    event.preventDefault()
    onSelect(card.id)
  }
  return <Link
    className="qcard" href={`/orders/${card.id}`} onClick={select} aria-current={current ? "true" : undefined}
    aria-label={`${card.vehicle}, ${card.reference}, ${laneLabel(card.displayLane)}${why ? `, ${why.short}` : ""}`}
  >
    <span className="qcard-top">
      <span className="qcard-car">{card.vehicle}</span>
      <span className="qcard-stage"><span className={`stage-dot stage-${card.displayLane}`} />{laneLabel(card.displayLane)}</span>
    </span>
    <span className="qcard-meta">{card.reference} · {card.customer}</span>
    <span className="qcard-meta">{card.from.city} → {card.to.city}{date ? <> · <span className="qcard-date">{date.label.toLowerCase()} <b>{dateText(date.start, date.end, date.zone)}</b>{date.note ? `, ${date.note}` : ""}</span></> : null}</span>
    {why && <span className={`qcard-why tone-${why.tone}`}><Icon name={icon} size={14} /><span>{why.short}{more > 0 ? ` · +${more} more` : ""}</span></span>}
  </Link>
}

function dateText(start: string, end: string | null, zone: string | null): string {
  const day = fmtWeekday(start, zone)
  const from = fmtDateTime(start, zone, false).split(" ").pop() ?? ""
  if (!end) return `${day} ${from}`
  const to = fmtDateTime(end, zone, false).split(" ").pop() ?? ""
  return fmtWeekday(end, zone) === day ? `${day} ${from}–${to}` : fmtRange(start, end, zone)
}
