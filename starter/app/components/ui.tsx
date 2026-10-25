"use client"

import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"
import { fmtDateTime, fmtLong, fmtRange, relativeTo } from "@/lib/present/time"
import type { Actor, AttentionItem, Fact, OrderRef, RecordView, Tone } from "@/lib/present/types"
import { CLOSABLE_ITEM, CloseButton } from "./close"
import { Icon } from "./icons"

export function Pill({ tone = "neutral", children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return <span className={`pill tone-${tone}`}>{dot && <span className="pill-dot" />}{children}</span>
}

/** The order's lifecycle stage as a dot and its label. */
export function StagePill({ lane, label }: { lane: string; label: string }) {
  return <span className="pill"><span className={`stage-dot stage-${lane}`} />{label}</span>
}

/** A timestamp in the record's zone, with the full UTC time on hover. */
export function When({ at, zone, snapshotAt, relative = false, withZone = true }: { at: string | null | undefined; zone?: string | null; snapshotAt?: string | null; relative?: boolean; withZone?: boolean }) {
  if (!at) return null
  const rel = relative ? relativeTo(at, snapshotAt) : null
  return <time dateTime={at} title={fmtLong(at)}>{fmtDateTime(at, zone, withZone)}{rel ? ` (${rel.text})` : ""}</time>
}

export function Range({ start, end, zone }: { start: string | null | undefined; end: string | null | undefined; zone?: string | null }) {
  if (!start) return null
  return <time dateTime={start} title={`${fmtLong(start)}${end ? ` to ${fmtLong(end)}` : ""}`}>{end ? fmtRange(start, end, zone) : fmtDateTime(start, zone)}</time>
}

/** Where a person or place has its own page. Operators and agents are roles, not records. */
export function actorHref(actor: Actor): string | null {
  if (!actor.id) return null
  if (actor.kind === "driver") return `/drivers/${actor.id}`
  if (actor.kind === "customer") return `/customers/${actor.id}`
  if (actor.kind === "site_contact") return `/sites/${actor.id}`
  return null
}

export function ActorName({ actor }: { actor: Actor }) {
  const href = actorHref(actor)
  return href ? <Link className="name-link" href={href}>{actor.name}</Link> : <>{actor.name}</>
}

export function OrderLink({ order }: { order: OrderRef }) {
  return <Link className="ref-link" href={`/orders/${order.id}`}>{order.reference}</Link>
}

export function OrderLinks({ orders }: { orders: OrderRef[] }) {
  return <>{orders.map((order, index) => <span key={order.id}>{index > 0 ? ", " : ""}<OrderLink order={order} /></span>)}</>
}

export function FactList({ facts }: { facts: Fact[] }) {
  return <dl className="facts">{facts.map((fact) => <div className={`fact${fact.tone ? ` tone-${fact.tone}` : ""}`} key={fact.label}>
    <dt>{fact.label}</dt>
    <dd>{fact.href ? <Link className="name-link" href={fact.href}>{fact.value}</Link> : fact.value}{fact.hint && <small>{fact.hint}</small>}</dd>
  </div>)}</dl>
}

export function SectionHead({ title, count, note }: { title: string; count?: number | null; note?: ReactNode }) {
  return <div className="sec-head"><h2>{title}</h2>{count != null && count > 0 && <span className="count">{count}</span>}{note && <span className="note">{note}</span>}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function More({ label, children, open = false }: { label: string; children: ReactNode; open?: boolean }) {
  return <details className="more" open={open}><summary><Icon name="chevron" size={12} />{label}</summary>{children}</details>
}

/** The model illustration, honest about being one. */
export function CarPhoto({ view, className = "photo", sizes, priority = false }: { view: RecordView; className?: string; sizes: string; priority?: boolean }) {
  const vehicle = view.header.vehicle
  if (!vehicle?.illustrationSlug) return <div className="photo-missing"><Icon name="car" />{vehicle ? "No illustration for this model" : "Vehicle not linked"}</div>
  return <figure className={className}>
    <Image src={`/car-images/${vehicle.illustrationSlug}.webp`} alt={`Illustration of a ${vehicle.title}`} fill sizes={sizes} priority={priority} />
    <figcaption className="photo-note" title="Orders with the same model share this picture. It is not a photo or evidence of this car.">Model illustration</figcaption>
  </figure>
}

const ATTENTION_ICON: Record<AttentionItem["kind"], string> = {
  alert: "alert", owned_alert: "alert", work: "work", incident: "incident", waiting: "waiting", conversation: "message",
  proposal: "proposal", claim: "alert", custody: "key", check: "note", inbox: "inbox",
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** What in the records is waiting on a person, or an honest note on what was checked. */
export function OpenItems({ view, limit }: { view: RecordView; limit?: number }) {
  const items = view.attention
  if (items.length === 0) return <div className="items-quiet">
    <Icon name="check" />
    <span>Nothing in the records is waiting on a person.
      <small>Checked: alerts, incidents, work items, conversations, agent proposals, claims, custody and a moving car&apos;s position. Not checked: proofs, documents and endpoint details beyond a booked car&apos;s pickup contact and access.</small></span>
  </div>
  const shown = limit ? items.slice(0, limit) : items
  return <div className="items">
    <div className="items-head">Needs a person <span>{items.length}</span></div>
    {shown.map((item) => <div className="item" key={`${item.kind}-${item.recordId}`}>
      <Icon name={ATTENTION_ICON[item.kind]} className={`tone-${item.tone}`} />
      <div>
        <div className={`item-title tone-${item.tone}`}>{item.title}</div>
        {item.detail && <div className="item-detail">{item.detail}</div>}
      </div>
      <div className="item-side">{item.owner ?? "No owner"}{item.at && item.atLabel ? <><br />{capitalise(item.atLabel)} <When at={item.at} snapshotAt={view.snapshotAt} relative withZone={false} /></> : null}
        {CLOSABLE_ITEM[item.kind] && <div><CloseButton orderId={view.header.id} record={{ collection: CLOSABLE_ITEM[item.kind]!.collection, recordId: item.recordId }} verb={CLOSABLE_ITEM[item.kind]!.verb} /></div>}</div>
    </div>)}
    {limit && items.length > limit && <div className="item"><span /><div className="item-detail">{items.length - limit} more on the order page.</div></div>}
  </div>
}
