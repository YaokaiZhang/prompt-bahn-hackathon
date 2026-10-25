"use client"

import type { FirstAction, Group, PlannedAction, RuleResult, SourceRef } from "@/lib/engine/checks"
import type { OrderChecks, Tone } from "@/lib/present/types"
import { Icon } from "./icons"
import { CallsBlock } from "./calls"
import { EffectsBlock } from "./effects"
import { CompactProposals, ProposalsBlock } from "./proposals"
import { PublishingBlock } from "./publishing"
import { ReviewBlock } from "./review"
import { More, Pill } from "./ui"

export const GROUP_LABEL: Record<Group, string> = {
  needs_action: "Problem", in_progress: "In progress", solved: "Fixed, review it", normal: "Normal", done: "Finished",
}

export function groupTone(group: Group, urgent = false): Tone {
  return group === "needs_action" ? (urgent ? "danger" : "warn") : group === "in_progress" || group === "solved" ? "accent" : group === "done" ? "ok" : "neutral"
}

export function GroupPill({ group, urgent = false }: { group: Group; urgent?: boolean }) {
  return <Pill tone={groupTone(group, urgent)}>{group === "normal" ? <><Icon name="check" size={13} />Checked · Normal</> : GROUP_LABEL[group]}</Pill>
}

const FIRST_ACTION: Record<FirstAction, string> = {
  site_call: "routine site call", driver_call: "routine driver call", reviewer_pass: "reviewer pass", show_person: "shown to a person", operator_proposal: "a proposal to you",
}

/** The folded record section on the order page that holds each collection. */
const SECTION: Record<string, string> = {
  order_endpoint_details: "route", time_windows: "route", sites: "route", transport_points: "route", endpoint_claims: "route", tracking_observations: "route",
  alerts: "work", work_items: "work", incidents: "work",
  work_assignments: "drivers",
  travel_reservations: "travel",
  expenses: "costs",
  documents: "evidence-details", proofs: "evidence-details", custody_assets: "evidence-details",
  agent_proposals: "proposals",
  conversations: "conversations",
}

export function sourceHref(orderId: string, source: SourceRef, samePage: boolean): string {
  const anchor = SECTION[source.collection] ?? "records"
  return samePage ? `#${anchor}` : `/orders/${encodeURIComponent(orderId)}#${anchor}`
}

function Sources({ orderId, sources, samePage }: { orderId: string; sources: SourceRef[]; samePage: boolean }) {
  if (!sources.length) return null
  return <span className="check-sources">{sources.map((source) => <a key={`${source.collection}-${source.id}`} className="source-link"
    href={sourceHref(orderId, source, samePage)} title={`${source.collection} ${source.id}`}>{source.label}<span className="source-id">{source.id}</span></a>)}</span>
}

const OUTCOME_ICON = { fail: "alert", unknown: "note", pass: "check" } as const

function RuleItem({ orderId, rule, samePage }: { orderId: string; rule: RuleResult; samePage: boolean }) {
  const tone: Tone = rule.outcome === "fail" ? (rule.firstAction === "show_person" || rule.firstAction === "operator_proposal" ? "danger" : "warn") : rule.outcome === "pass" ? "ok" : "neutral"
  return <li className="check">
    <Icon name={OUTCOME_ICON[rule.outcome]} className={`tone-${tone}`} />
    <div>
      <div className="check-title">{rule.title}{rule.strength === "weak" && <span className="check-kind">weak signal</span>}</div>
      <div className="check-detail">{rule.detail}{rule.outcome === "fail" && rule.firstAction ? <> First action: <b>{FIRST_ACTION[rule.firstAction]}</b>.</> : null}</div>
      <Sources orderId={orderId} sources={rule.sources} samePage={samePage} />
    </div>
  </li>
}

function plannedText(action: PlannedAction): string {
  if (action.kind === "reviewer_pass") return "Reviewer pass over the order's records"
  const who = action.callee ? `${action.callee.name ?? "the contact"}${action.callee.role ? ` (${action.callee.role})` : ""}, ${action.callee.handle}` : null
  return action.kind === "site_call" ? `Routine site call to ${who ?? "the pickup site"}` : "Routine driver call to the assigned driver"
}

/** What the engine checked on one order: its group and why, planned agent work, and each rule with its source records. */
export function ChecksPanel({ orderId, checks, compact = false }: { orderId: string; checks: OrderChecks; compact?: boolean }) {
  const samePage = !compact
  // Urgency ranks Problem; on other groups it would read as a second verdict.
  const urgent = checks.group === "needs_action" && checks.urgency.urgent
  const failed = checks.rules.filter((rule) => rule.outcome === "fail")
  const unknown = checks.rules.filter((rule) => rule.outcome === "unknown")
  const passed = checks.rules.filter((rule) => rule.outcome === "pass")
  const list = (rules: RuleResult[]) => <ul className="checks-list">{rules.map((rule) => <RuleItem key={rule.id} orderId={orderId} rule={rule} samePage={samePage} />)}</ul>
  return <section className={`checks${compact ? " checks-compact" : ""}`} id="checks" aria-label="What the system checked">
    <div className="checks-head">
      <GroupPill group={checks.group} urgent={urgent} />
      {urgent && <Pill tone="danger">Urgent</Pill>}
      <span className="checks-count">Checked {checks.rules.length} rules · {passed.length} passed{unknown.length ? ` · ${unknown.length} couldn't check` : ""}{failed.length ? ` · ${failed.length} didn't pass` : ""}</span>
    </div>
    <p className={`checks-reason tone-${groupTone(checks.group, urgent)}`}>{checks.reason}</p>
    {urgent && <p className="checks-urgency">{checks.urgency.reasons.map((reason) => reason.text).join(" · ")}</p>}
    {checks.publication && <PublishingBlock orderId={orderId} publication={checks.publication} group={checks.group} calls={checks.calls ?? []} reviewed={checks.review?.status === "reviewed"} />}
    {checks.planned.length > 0 && <div className="checks-block">
      <h3>Planned agent work</h3>
      <ul className="checks-list">{checks.planned.map((action) => <li className="check" key={action.kind}>
        <Icon name={action.kind === "reviewer_pass" ? "bot" : "phone"} className="tone-accent" />
        <div>
          <div className="check-title">{plannedText(action)}<span className="check-kind">planned, not started</span></div>
          <div className="check-detail">{action.ruleIds.map((id) => checks.rules.find((rule) => rule.id === id)?.detail ?? id).join(" ")}</div>
        </div>
      </li>)}</ul>
    </div>}
    <CallsBlock orderId={orderId} calls={checks.calls} lines={checks.callLines} blocked={checks.blockedCalls} compact={compact} />
    {compact ? <CompactProposals orderId={orderId} proposals={checks.proposals ?? []} /> : <ProposalsBlock orderId={orderId} proposals={checks.proposals ?? []} />}
    {!compact && <EffectsBlock effects={checks.effects ?? []} history={checks.history ?? []} />}
    {checks.review && <ReviewBlock orderId={orderId} review={checks.review} compact={compact}
      shown={new Set((checks.proposals ?? []).map((proposal) => proposal.findingId).filter((id): id is string => !!id))} />}
    {failed.length > 0 && <div className="checks-block"><h3>Didn&apos;t pass</h3>{list(failed)}</div>}
    {unknown.length > 0 && <div className="checks-block"><h3>Couldn&apos;t check</h3>{list(unknown)}</div>}
    {passed.length > 0 && (compact
      ? <More label={`Passed (${passed.length})`}>{list(passed)}</More>
      : <div className="checks-block"><h3>Passed</h3>{list(passed)}</div>)}
  </section>
}
