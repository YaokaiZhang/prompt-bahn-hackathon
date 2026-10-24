"use client"

import Link from "next/link"
import type { JourneyGroup, JourneyLeg, JourneyStep, RecordView } from "@/lib/present/types"
import { fmtDateTime, relativeTo } from "@/lib/present/time"
import { ActorName, Pill, Range, When } from "./ui"

/** The route as Bahn draws it: an orange pickup pin, a line, a red delivery pin. */
export function Route({ view }: { view: RecordView }) {
  const groups = view.journey.groups
  if (!groups.length) return null
  return <div className="route">
    {groups.map((group) => <RouteGroup key={group.itemId} group={group} view={view} labelled={groups.length > 1} />)}
  </div>
}

function RouteGroup({ group, view, labelled }: { group: JourneyGroup; view: RecordView; labelled: boolean }) {
  const legsFrom = new Map(group.legs.map((leg) => [leg.fromStepId, leg]))
  const multi = group.steps.length > 2
  return <div className="route-group">
    {labelled && <p className="route-group-label">{group.roleLabel}: {group.vehicle}</p>}
    <div className={`route-track${multi ? " multi" : ""}`}>
      {group.steps.map((step) => {
        const leg = legsFrom.get(step.id)
        return <RouteStop key={step.id} step={step} leg={leg ?? null} view={view} />
      })}
    </div>
  </div>
}

function RouteStop({ step, leg, view }: { step: JourneyStep; leg: JourneyLeg | null; view: RecordView }) {
  const pin = step.role === "PICKUP" ? "pin-pickup" : step.role === "DELIVERY" ? "pin-delivery" : "pin-transfer"
  const slot = step.windows.find((window) => window.selected && (window.purpose === "SELECTED_PICKUP_SLOT" || window.purpose === "CUSTOMER_DELIVERY_PROMISE" || window.purpose === "SELECTED_DELIVERY_SLOT"))
    ?? step.windows.find((window) => window.purpose.startsWith("REQUESTED_")) ?? null
  const name = step.site ? <Link className="name-link" href={`/sites/${step.site.id}`}>{step.place.name}</Link> : step.place.name
  return <>
    <div className="stop">
      <div className="stop-role"><span className={`pin ${pin}`} />{step.roleLabel}</div>
      <div className="stop-name">{name}</div>
      <div className="stop-city">{step.place.city}{step.place.country ? `, ${step.place.country}` : ""}{step.site ? "" : " · no site profile"}</div>
      {step.recorded
        ? <div className="stop-when done">{step.recorded.label} <When at={step.recorded.at} zone={step.place.zone ?? slot?.zone ?? null} /></div>
        : slot ? <div className="stop-when"><span>{slot.label}</span> <Range start={slot.start} end={slot.end} zone={slot.zone} /></div>
        : <div className="stop-when"><span>No slot selected</span></div>}
      {!step.recorded && (step.contact || step.access || step.claims.some((claim) => claim.status === "OPEN")) && <div className="stop-state">
        {step.contact && <Pill tone={step.contact.tone}>Contact {step.contact.statusLabel.toLowerCase()}</Pill>}
        {step.access && <Pill tone={step.access.tone}>Access {step.access.statusLabel.toLowerCase()}</Pill>}
        {step.claims.some((claim) => claim.status === "OPEN") && <Pill tone="warn">Open claim</Pill>}
      </div>}
    </div>
    {leg && <Leg leg={leg} view={view} />}
  </>
}

function Leg({ leg, view }: { leg: JourneyLeg; view: RecordView }) {
  const assignment = leg.assignment
  const age = leg.tracking?.receivedAt ? relativeTo(leg.tracking.receivedAt, view.snapshotAt) : null
  const progress = leg.status === "COMPLETED" ? 1 : leg.tracking?.progress ?? 0
  const zone = view.header.keyDates.find((date) => date.key === "promise")?.zone ?? null
  return <div className={`leg tone-${leg.tone}`}>
    <span className="leg-line" style={{ ["--progress" as string]: `${Math.round(progress * 100)}%` }} aria-hidden="true" />
    {leg.distanceKm != null && <b>{leg.distanceKm} km</b>}
    {assignment ? <span><ActorName actor={assignment.driver} /> · {assignment.statusLabel.toLowerCase()}</span> : <span>No driver yet</span>}
    {leg.tracking?.eta && <span className="leg-eta">ETA {fmtDateTime(leg.tracking.eta, zone)}{age ? ` · signal ${age.text}` : ""}</span>}
  </div>
}

/** The route in one line for the queue preview: pickup pin, progress, delivery pin. */
export function RouteSummary({ view }: { view: RecordView }) {
  const group = view.journey.groups[0]
  if (!group || group.steps.length < 2) return null
  const first = group.steps[0]
  const last = group.steps[group.steps.length - 1]
  const done = group.legs.filter((leg) => leg.status === "COMPLETED").length
  const live = group.legs.find((leg) => leg.status === "IN_PROGRESS")
  const progress = group.legs.length ? (done + (live?.tracking?.progress ?? 0)) / group.legs.length : 0
  const km = view.journey.distanceKm
  return <div className="route-summary">
    <span className="route-summary-end"><span className="pin pin-pickup" />{first.place.city}</span>
    <span className="route-summary-line" style={{ ["--progress" as string]: `${Math.round(progress * 100)}%` }} aria-hidden="true" />
    <span className="route-summary-end"><span className="pin pin-delivery" />{last.place.city}</span>
    {km != null && <span className="route-summary-km">{km} km{group.steps.length > 2 ? ` · ${group.steps.length - 2} transfer${group.steps.length > 3 ? "s" : ""}` : ""}</span>}
  </div>
}
