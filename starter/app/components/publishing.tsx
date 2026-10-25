"use client"

// Publishing (spec .scratch/publishing) on the order: the call results waiting for the
// operator's yes, each as a rewrite (what the records said, what the call says now) with
// the call's transcript, and the order's stage on the driver market. Actions post to
// /api/publishing and then fire CLOCK_EVENT ("engine state changed").

import { useState } from "react"
import type { Call } from "@/lib/engine/calls"
import type { Publication, SolvedChange } from "@/lib/engine/publishing"
import { fmtDateTime } from "@/lib/present/time"
import { Transcript } from "./calls"
import { CLOCK_EVENT } from "./demo-clock"
import { Icon } from "./icons"
import { More, Pill } from "./ui"

async function sendPublishing(action: "confirm" | "publish", orderId: string): Promise<void> {
  const response = await fetch("/api/publishing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, orderId }) })
  const data = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new Error(data?.error ?? "Nothing changed")
  window.dispatchEvent(new Event(CLOCK_EVENT))
}

function Rewrite({ change, call }: { change: SolvedChange; call: Call | null }) {
  return <li className="rewrite">
    <div className="rewrite-point">{change.point}</div>
    {change.asked.length > 0 && change.asked.join("; ") !== change.point && <div className="rewrite-asked">Asked about: {change.asked.join("; ")}</div>}
    <dl className="rewrite-diff">
      <dt>Before</dt>
      <dd>{change.before.length
        ? <ul>{change.before.map((row) => <li key={row.recordId}><span className="rewrite-old">{row.text}</span> <span className="source-id">{row.recordId}</span></li>)}</ul>
        : <span className="rewrite-none">Nothing on record settled this point.</span>}</dd>
      <dt>Now</dt>
      <dd className="rewrite-new">{change.after}</dd>
    </dl>
    {change.call && <p className="rewrite-meta">
      {change.call.who} on the {change.call.line} call{change.call.endedAt ? `, ${fmtDateTime(change.call.endedAt, null, false)}` : ""} · tier {change.call.tier}
    </p>}
    {call && <More label={`Call transcript (${call.transcript.length} lines)`}><Transcript call={call} /></More>}
  </li>
}

const STAGE_TEXT = (publication: Publication): string => {
  if (publication.stage === "market") {
    const by = publication.published ? `Published by the ${publication.published.by === "agent" ? "agent" : "operator"} ${fmtDateTime(publication.published.at, null, false)}` : "On the driver market in the data"
    const filter = !publication.check ? "the demand filter has not run yet" : !publication.check.demanding ? "not demanding: live for drivers"
      : publication.plan ? "demanding: live for drivers with a travel plan" : "demanding: waiting for its travel plan before drivers see it"
    return `${by}; ${filter}.`
  }
  if (publication.stage === "confirm") return "Not on the market yet: the agent's calls changed what the records say, so it waits for your yes before publishing."
  if (publication.stage === "unposted") return "Not on the market yet. The agent publishes it once it is Normal and the reviewer has read it."
  return "Already past the market: a driver is on it, or it is finished."
}

/** The order's publishing state and, when Solved, the rewrites to approve. */
export function PublishingBlock({ orderId, publication, group, calls, reviewed }: { orderId: string; publication: Publication; group: string; calls: Call[]; reviewed: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const act = (action: "confirm" | "publish") => {
    setBusy(true)
    setError("")
    sendPublishing(action, orderId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Nothing changed")).finally(() => setBusy(false))
  }
  const pending = group === "solved" ? publication.pending : []
  const canPublish = publication.stage === "unposted" && group === "normal"
  if (publication.stage === "posted" && !pending.length) return null
  return <div className="checks-block publishing" id="publishing">
    <h3>{pending.length ? "Fixed, review it" : "Driver market"}</h3>
    <p className="publishing-stage"><Icon name="offer" className={publication.stage === "market" ? "tone-accent" : "tone-neutral"} />{STAGE_TEXT(publication)}</p>
    {publication.check?.demanding && <p className="publishing-filter">{publication.check.reasons.map((reason) => <Pill key={reason} tone="warn">{reason}</Pill>)}</p>}
    {pending.length > 0 && <>
      <p className="publishing-note">The agent&apos;s calls settled {pending.length === 1 ? "this point" : `these ${pending.length} points`}. Check each rewrite against the call, then approve to publish the order to drivers.</p>
      <ol className="rewrites">{pending.map((change) => <Rewrite key={change.effectId} change={change} call={calls.find((call) => call.id === change.call?.id) ?? null} />)}</ol>
      <div className="publishing-actions">
        <button type="button" className="btn btn-primary btn-s" disabled={busy} onClick={() => act("confirm")}><Icon name="check" />Approve and publish</button>
      </div>
    </>}
    {canPublish && <div className="publishing-actions">
      <button type="button" className="btn btn-tertiary btn-s" disabled={busy} onClick={() => act("publish")}><Icon name="offer" />Publish now</button>
      {!reviewed && <span className="publishing-note">The reviewer has not read it yet, so the agent will not publish it alone.</span>}
    </div>}
    {error && <p className="publishing-error" role="alert">{error}</p>}
  </div>
}
