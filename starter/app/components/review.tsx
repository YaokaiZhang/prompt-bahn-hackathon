"use client"

// The reviewer's read of one order (ticket 06): what it read, what it found, and
// each finding's cited records with the quoted values highlighted. Cited records
// are also marked where they appear on the order page (`useCited`).

import { createContext, useContext, type ReactNode } from "react"
import type { CitedRecord, OrderReview, ReviewFinding } from "@/lib/engine/reviews"
import { humanize } from "@/lib/present/labels"
import { Icon } from "./icons"
import { Pill } from "./ui"

/** Record ids the order's findings cite. The order page provides it; rows read it to mark themselves. */
const CitedContext = createContext<ReadonlySet<string>>(new Set())

export function CitedProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  return <CitedContext.Provider value={new Set(ids)}>{children}</CitedContext.Provider>
}

export function useCited(): ReadonlySet<string> {
  return useContext(CitedContext)
}

/** Marks a record a reviewer finding cites, where the record is shown. */
export function CitedTag() {
  return <span className="cited-tag"><Pill tone="danger">Cited by the reviewer</Pill></span>
}

/** The anchor a cited record carries where it is shown on the order page. */
export function recordAnchor(recordId: string): string {
  return `rec-${recordId}`
}

/** Where on the order page a record of this kind is shown. Messages and notes carry their own anchor. */
const SECTION_OF_KIND: Record<string, string> = {
  message: "", order_notes: "", conversation: "",
  order: "facts", order_item: "facts", customer: "facts",
  order_endpoint_details: "route", time_windows: "route", transport_points: "route", transport_plans: "route", transport_segments: "route",
  endpoint_claims: "route", tracking_observations: "route", address: "route", site_profile: "route",
  alert: "work", work_items: "work", incidents: "work",
  work_assignments: "drivers", assignment_steps: "drivers",
  market_offers: "market",
  travel_reservations: "travel", travel_options: "travel", travel_confirmations: "travel",
  expenses: "costs",
  documents: "evidence-details", proofs: "evidence-details", custody_assets: "evidence-details",
  agent_proposals: "proposals", internal_notifications: "proposals",
  operational_event: "events",
}

function citedHref(cited: CitedRecord, samePage: boolean, orderId: string): string {
  const section = cited.kind ? SECTION_OF_KIND[cited.kind] : undefined
  const anchor = section === "" ? recordAnchor(cited.recordId) : section ?? "records"
  return samePage ? `#${anchor}` : `/orders/${encodeURIComponent(orderId)}#${anchor}`
}

const KIND_LABEL: Record<string, string> = {
  order_endpoint_details: "Endpoint", order_notes: "Order note", site_profile: "Site profile", operational_event: "Event",
  work_assignments: "Assignment", assignment_steps: "Duty step", endpoint_claims: "Endpoint claim", inbox_thread: "Inbox thread",
}

function kindLabel(kind: string | null): string {
  if (!kind) return "Record"
  return KIND_LABEL[kind] ?? humanize(kind).replace(/s$/, "")
}

/** The field text with every occurrence of the quote marked (case- and spacing-insensitive). */
export function Highlighted({ text, quote }: { text: string; quote: string }) {
  const wanted = quote.trim().replace(/^["']|["']$/g, "").replace(/[.]$/, "")
  if (!wanted) return <>{text}</>
  const pattern = new RegExp(wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi")
  const parts: ReactNode[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > at) parts.push(text.slice(at, start))
    parts.push(<mark className="quote-mark" key={start}>{match[0]}</mark>)
    at = start + match[0].length
  }
  if (parts.length === 0) return <>{text} <mark className="quote-mark">{quote}</mark></>
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

export function CitedRow({ cited, orderId, samePage }: { cited: CitedRecord; orderId: string; samePage: boolean }) {
  const value = cited.value && cited.value.length <= 600 ? cited.value : null
  return <li className={`cited cited-${cited.role}`}>
    <div className="cited-head">
      <span className="cited-kind">{cited.role === "contact" ? "Names the contact · " : ""}{kindLabel(cited.kind)}{cited.field ? <span className="cited-field"> · {cited.field.replace(/_/g, " ")}</span> : null}</span>
      <a className="source-link" href={citedHref(cited, samePage, orderId)} title={`Open ${cited.recordId}`}>{cited.recordId}</a>
    </div>
    <p className="cited-value">{value ? <Highlighted text={value} quote={cited.quote} /> : <mark className="quote-mark">{cited.quote}</mark>}</p>
    {(cited.local || cited.statedBy) && <div className="cited-meta">{[cited.local, cited.statedBy ? `stated by ${cited.statedBy}` : null].filter(Boolean).join(" · ")}</div>}
  </li>
}

const ROLE_LABEL: Record<string, string> = { site: "Site", driver: "Driver", operator: "Operator", customer: "Customer" }

function FindingCard({ finding, orderId, samePage }: { finding: ReviewFinding; orderId: string; samePage: boolean }) {
  const conflict = finding.cited.filter((cited) => cited.role === "conflict")
  const contact = finding.cited.filter((cited) => cited.role === "contact")
  return <article className="finding" id={finding.id}>
    <div className="finding-title"><Icon name="alert" className="tone-danger" />{finding.title}</div>
    <dl className="finding-facts">
      <div><dt>Ask</dt><dd>{finding.ask.name} <span className="finding-role">({ROLE_LABEL[finding.ask.role] ?? finding.ask.role})</span></dd></div>
      <div><dt>Question</dt><dd className="finding-question">{finding.question}</dd></div>
      <div><dt>Why</dt><dd>{finding.why}</dd></div>
      <div><dt>Who pays</dt><dd>{finding.whoPays}</dd></div>
      <div><dt>Policy</dt><dd><Pill tone={finding.policyRow === "customer-side" || finding.policyRow === "order-change" ? "warn" : "neutral"}>{finding.policyRow}</Pill></dd></div>
    </dl>
    <h4 className="finding-sub">Records that disagree</h4>
    <ul className="cited-list">{conflict.map((cited, i) => <CitedRow key={`${cited.recordId}-${i}`} cited={cited} orderId={orderId} samePage={samePage} />)}</ul>
    {contact.length > 0 && <ul className="cited-list">{contact.map((cited, i) => <CitedRow key={`${cited.recordId}-c${i}`} cited={cited} orderId={orderId} samePage={samePage} />)}</ul>}
  </article>
}

function money(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`
}

/** One line on what the reviewer did, for the compact preview and the panel head. */
export function reviewLine(review: OrderReview): string {
  if (review.status !== "reviewed") return "Not reviewed yet"
  const found = review.findings.length ? `${review.findings.length} ${review.findings.length === 1 ? "finding" : "findings"}` : "no conflict"
  return `Reviewer read ${review.recordsRead} records, ${found}`
}

/** `shown`: findings already shown as proposals (with their evidence); the rest are listed here. */
export function ReviewBlock({ orderId, review, compact = false, shown = new Set() }: { orderId: string; review: OrderReview; compact?: boolean; shown?: ReadonlySet<string> }) {
  const rest = review.findings.filter((finding) => !shown.has(finding.id))
  const reviewed = review.status === "reviewed"
  const why = review.trigger === "records" ? `Goes to the reviewer: ${review.triggers.join(", ")}.` : "No free-text records; covered by the seed sweep."
  return <div className="checks-block review" id="review">
    <h3>Reviewer</h3>
    <div className="check">
      <Icon name="bot" className={reviewed ? (review.findings.length ? "tone-danger" : "tone-ok") : "tone-neutral"} />
      <div>
        <div className="check-title">{reviewLine(review)}{reviewed && review.cost > 0 && <span className="check-kind">model cost {money(review.cost)}</span>}</div>
        <div className="check-detail">
          {reviewed ? (review.summary ?? "") : (review.reason ?? "Not reviewed yet").replace(/^not reviewed yet:?\s*/i, "").replace(/^./, (c) => c.toUpperCase()) || "The reviewer has not read this order."}
          {!compact && <> {why}</>}
          {reviewed && review.dropped > 0 && <> {review.dropped} {review.dropped === 1 ? "finding was" : "findings were"} dropped for quotes that did not match the records.</>}
        </div>
      </div>
    </div>
    {!compact && rest.length > 0 && <p className="check-detail review-unreachable">{rest.length === 1 ? "This finding has" : "These findings have"} no proposal: no contact is on record to call, so {rest.length === 1 ? "it is" : "they are"} listed as couldn&apos;t check.</p>}
    {!compact && rest.map((finding) => <FindingCard key={finding.id} finding={finding} orderId={orderId} samePage />)}
    {compact && rest.length > 0 && <ul className="checks-list">{rest.map((finding) => <li className="check" key={finding.id}>
      <Icon name="alert" className="tone-danger" />
      <div><div className="check-title">{finding.title}</div><div className="check-detail">Ask {finding.ask.name}: {finding.question}</div></div>
    </li>)}</ul>}
  </div>
}
