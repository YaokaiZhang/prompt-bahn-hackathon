// The situation card (ui-revision): one order that is not normal, read as what is wrong,
// one or two sentences of situation and suggestion, the step to take and the other steps
// on offer. Deterministic: it shortens the engine's own words (rule details, handovers,
// proposals, call lines). No model call. Every step maps to an existing API action
// (/api/proposals, /api/calls, /api/publishing) or opens the order page.
//
// Pure, and only type imports, so the order page can run it in the browser too.

import type { Group, PlannedAction, RuleResult, Urgency } from "@/lib/engine/checks"
import type { Call, CallLineView } from "@/lib/engine/calls"
import type { Proposal } from "@/lib/engine/proposals"
import type { Publication } from "@/lib/engine/publishing"

export type SituationInput = {
  group: Group
  rules: RuleResult[]
  urgency: Urgency
  planned: PlannedAction[]
  proposals: Proposal[]
  calls: Call[]
  callLines: CallLineView[]
  publication: Publication | null
}

/**
 * A step the operator can take from the card. `open` shows the evidence at an anchor (in the
 * queue preview or on the order page); `full` marks the one that leaves for the whole record.
 */
export type Step = { label: string } & (
  | { do: "approve"; proposalId: string }
  | { do: "answer"; proposalId: string; command: "recordAnswer" | "answerQuestion"; prompt: string }
  | { do: "dismiss"; proposalId: string }
  | { do: "instruct"; proposalId: string; prompt: string }
  | { do: "handover"; callId: string; prompt: string }
  | { do: "ring"; line: "site" | "driver" }
  | { do: "confirm" }
  | { do: "close"; records: { collection: string; recordId: string }[] }
  | { do: "open"; anchor: string; full?: true }
)

export type Situation = {
  /** What is wrong (or, In progress, what the agent is doing), in a few plain words. */
  headline: string
  /** One or two short sentences: the situation, then the suggestion. Null when the headline says it all. */
  body: string | null
  /** The suggested step; null when the agent is on it. */
  step: Step | null
  /** The other steps on offer ("Choose another step"). */
  others: Step[]
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const stop = (text: string) => text.trim().replace(/[.:;,]+$/, "")
const sentence = (text: string) => { const t = stop(text); return !t ? "" : /^\S*@/.test(t) ? `${t}.` : `${t.charAt(0).toUpperCase()}${t.slice(1)}.` }
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
/** The first clause of a long instruction: "Ask the receiver for X; review Y" -> "Ask the receiver for X". */
const firstClause = (text: string) => stop(text.split(/;\s|\.\s/)[0] ?? text)
/** "Adrian Alderbrook, stock control" -> "Adrian Alderbrook"; an address stays as it is. */
export const shortName = (name: string | null | undefined, fallback = "the contact") => (name ? name.split(",")[0].trim() : "") || fallback
const MAX_BODY = 190

function clip(text: string, max = MAX_BODY): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "))
  return end > 60 ? `${cut.slice(0, end)}.` : `${cut.slice(0, cut.lastIndexOf(" "))}…`
}

function joinBody(...parts: (string | null | undefined)[]): string | null {
  const text = parts.filter((part): part is string => !!part && !!part.trim()).map(sentence).join(" ")
  return text ? clip(text) : null
}

// ── Rule headlines ───────────────────────────────────────────────────────────

/** The rule's failure as what is wrong, plus the part of its detail the headline does not already say. */
export function ruleProblem(rule: RuleResult): { headline: string; situation: string | null } {
  const detail = rule.detail
  switch (rule.id) {
    case "R1": {
      const site = /^(.+?) requires a signed release/.exec(detail)?.[1]
      const when = /for the pickup on (.+?)\.?$/.exec(detail)?.[1]
      return { headline: site ? `No signed release for the pickup at ${site}` : "No signed release on file", situation: when ? `Pickup ${when}` : null }
    }
    case "R3": return { headline: "Driver can't come from the planned previous duty", situation: detail }
    case "R7": return { headline: "Promise isn't the slot the customer asked for", situation: detail }
    case "R10": return { headline: "No live position while the car is moving", situation: detail.replace(/^Car in transit and /, "") }
    case "R11": {
      const ended = /slot ended (.+?) and/.exec(detail)?.[1]
      return { headline: "Pickup slot passed, nothing collected", situation: ended ? `The slot ended ${ended}` : detail }
    }
    case "R12": {
      const said = /the driver said: (.+?)\. Decide/.exec(detail)?.[1]
      const reported = /^(.+?) reported an ETA of (.+?), after/.exec(detail)
      if (said) return { headline: "Car will arrive after the promise", situation: `Driver on the call: ${lower(stop(said))}` }
      if (reported) return { headline: "Car will arrive after the promise", situation: `${reported[1]} reported an ETA of ${reported[2]}` }
      return { headline: "Car will arrive after the promise", situation: detail }
    }
    case "R13": return { headline: "Driver travel claimed without a reservation", situation: detail }
    case "CLOSE": {
      const done = /^The order is (delivered|cancelled)/.exec(detail)?.[1] ?? "delivered"
      const open = /still open: (.+?)\.?$/.exec(detail)?.[1] ?? ""
      const items = open.split(", ").filter(Boolean)
      const onlyProof = items.length > 0 && items.every((item) => /^proof submitted/.test(item))
      const head = done === "cancelled" ? "Cancelled" : "Delivered"
      if (onlyProof) return { headline: `${head}, proof waits for review`, situation: null }
      const count = (/^The order is \w+ but (one|\d+) records?/.exec(detail)?.[1]) ?? String(items.length)
      return { headline: `${head}, but ${count === "one" ? "one record is" : `${count} records are`} still open`, situation: open ? `Open: ${open}` : null }
    }
    case "NEXT": return { headline: "A scheduled check is due", situation: detail.split("; ")[0] }
    default: return { headline: stop(rule.title), situation: detail }
  }
}

/** Where on the order page a rule's evidence sits, and the verb for looking at it. */
const RULE_OPEN: Partial<Record<RuleResult["id"], { label: string; anchor: string }>> = {
  CLOSE: { label: "Review the open records", anchor: "rule-CLOSE" },
  R1: { label: "Check the release", anchor: "rule-R1" },
  R11: { label: "Check the pickup", anchor: "attention" },
  R13: { label: "Check the travel claims", anchor: "rule-R13" },
  R12: { label: "Decide what to tell the customer", anchor: "checks" },
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** The proposal's own next step: approve it, or answer it once it is with the operator. */
function proposalStep(proposal: Proposal): Step | null {
  const name = shortName(proposal.contact.name)
  if (proposal.status === "proposed") {
    const label = proposal.kind === "change" ? "Approve the change"
      : proposal.kind === "call" ? `Let the agent call ${name}`
      : proposal.kind === "customer_contact" ? `Contact ${name}`
      : "Approve"
    return { label, do: "approve", proposalId: proposal.id }
  }
  if (proposal.status === "approved" && proposal.waitingOn === "operator") {
    if (proposal.kind === "customer_contact") return { label: `Record ${name}'s answer`, do: "answer", proposalId: proposal.id, command: "recordAnswer", prompt: `What ${name} answered` }
    if (proposal.kind === "operator_question") return { label: "Answer", do: "answer", proposalId: proposal.id, command: "answerQuestion", prompt: "Your answer to the agent" }
  }
  return null
}

/** "Name: Says X" -> "Name says X"; "Name: Driver cannot X" -> "Driver cannot X". */
export function whoSaid(name: string, claim: string): string {
  const text = stop(claim)
  return /^(Says|Said|Asks|Asked|Wants|\w+ed)\b/.test(text) ? `${name} ${lower(text)}` : text
}

/** What the proposal is about, as what is wrong. A call result reads as who said what. */
function proposalHeadline(proposal: Proposal): string {
  const said = /^(.+?) said on the \w+ call(?: at [\d:]+ UTC)?: (.+)$/.exec(proposal.why)
  if (said) return whoSaid(shortName(said[1]), said[2])
  return stop(proposal.title)
}

const ringable = (line: CallLineView) => !!line.callee && (line.status === "to_call" || line.status === "callback" || line.status === "callback_due" || line.status === "on_request")

const ringStep = (line: CallLineView): Step => ({ label: `Ring ${shortName(line.callee?.name ?? line.callee?.handle)} live`, do: "ring", line: line.line })

const openStep = (anchor: string, label: string): Step => ({ label, do: "open", anchor })

/** Closes what keeps a finished order open (the CLOSE rule's records): accept the proofs, or close them all. */
function closeStep(rule: RuleResult): Step | null {
  const records = rule.id === "CLOSE" ? rule.sources.filter((source) => source.close) : []
  if (!records.length) return null
  const proofs = records.every((source) => source.collection === "proofs" && source.close === "Accept")
  const label = proofs ? (records.length === 1 ? "Accept the proof" : `Accept the ${records.length} proofs`)
    : records.length === 1 ? `${records[0].close}: ${lower(records[0].label)}` : `Close all ${records.length} records`
  return { label, do: "close", records: records.map((source) => ({ collection: source.collection, recordId: source.id })) }
}
export const openOrder: Step = { label: "Open the order", do: "open", anchor: "checks", full: true }

/** The work item an urgency reason names: "Due work item: Ask X; do Y" -> "Ask X". */
function workItem(urgency: Urgency): string | null {
  const reason = urgency.reasons.find((row) => /^(Overdue|Due) work item: /.test(row.text))
  return reason ? firstClause(reason.text.replace(/^(Overdue|Due) work item: /, "")) : null
}

function uniqueSteps(steps: (Step | null)[], primary: Step | null): Step[] {
  const seen = new Set<string>(primary ? [JSON.stringify(primary)] : [])
  const out: Step[] = []
  for (const step of steps) {
    if (!step) continue
    const key = JSON.stringify(step)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(step)
  }
  return out
}

/** A handover summary, "Adrian Aldermere: Says they are not the pickup contact.", as a headline. */
function summaryHeadline(summary: string, name: string): string {
  const said = /^([^:]{1,60}):\s*(.+)$/.exec(summary)
  return said ? whoSaid(shortName(said[1], name), said[2]) : stop(summary)
}

// ── The situation ────────────────────────────────────────────────────────────

function needsAction(input: SituationInput): Situation {
  const handover = [...input.calls].reverse().find((call) => call.handover && !call.handover.closed) ?? null
  const forOperator = input.proposals.filter((proposal) => proposal.waitingOn === "operator")
  const decisions = input.rules.filter((rule) => rule.outcome === "fail" && rule.firstAction === "show_person")
  const forPerson = input.callLines.filter((line) => line.status === "needs_person")
  const proposalSteps = forOperator.map(proposalStep)
  const lineSteps = input.callLines.filter(ringable).map(ringStep)
  const dismissals = forOperator.filter((proposal) => proposal.status === "proposed").map((proposal): Step => ({ label: "Dismiss the proposal", do: "dismiss", proposalId: proposal.id }))
  const suggestion = workItem(input.urgency)

  if (handover?.handover) {
    const note = handover.handover
    const name = shortName(handover.callee.name ?? handover.callee.handle)
    const step: Step = { label: "Record what you learned", do: "handover", callId: handover.id, prompt: `What you learned (closes the handover with ${name})` }
    return {
      headline: summaryHeadline(note.summary, name),
      body: joinBody(`${name} handed it over from the ${handover.line} call`, `Suggestion: ${lower(stop(note.nextStep))}`),
      step,
      others: uniqueSteps([...proposalSteps, ...lineSteps, ...dismissals, openStep("calls", "Read the call")], step),
    }
  }

  if (decisions.length) {
    const rule = decisions[0]
    const problem = ruleProblem(rule)
    // A question or contact the agent drafted is the step; a call result to approve waits in "another step".
    const proposal = forOperator.find((row) => row.kind !== "change") ?? null
    const fromProposal = proposal ? proposalStep(proposal) : null
    const open = RULE_OPEN[rule.id]
    const closing = closeStep(rule)
    const step = fromProposal ?? closing ?? (open ? openStep(open.anchor, open.label) : openOrder)
    const suggest = proposal ? `Suggestion: ${lower(stop(proposal.action))}` : suggestion ? `Suggestion: ${lower(suggestion)}` : null
    const more = decisions.length > 1 ? `Also: ${lower(ruleProblem(decisions[1]).headline)}` : null
    return {
      headline: problem.headline,
      body: joinBody(problem.situation, suggest ?? more),
      step,
      others: uniqueSteps([...proposalSteps, ...lineSteps, ...dismissals, closing, open ? openStep(open.anchor, open.label) : null, openOrder], step),
    }
  }

  if (forOperator.length) {
    const proposal = forOperator[0]
    const step = proposalStep(proposal) ?? openStep(proposal.id, "Read the proposal")
    const situation = proposal.kind === "change" ? `Approving writes it to the order` : proposal.why
    const suggest = proposal.kind === "change" ? null : `Suggestion: ${lower(stop(proposal.action))}`
    return {
      headline: proposalHeadline(proposal),
      body: joinBody(situation, suggest),
      step,
      others: uniqueSteps([...proposalSteps, ...lineSteps, ...dismissals, { label: "Give an instruction", do: "instruct", proposalId: proposal.id, prompt: "Your instruction to the agent" }, openOrder], step),
    }
  }

  if (forPerson.length) {
    const line = forPerson[0]
    const name = shortName(line.callee?.name ?? line.callee?.handle)
    const unreachable = line.latest?.outcome === "unreachable"
    return {
      headline: unreachable ? `${name} can't be reached` : `The call with ${name} needs a person`,
      body: joinBody(line.latest?.reason ?? null, suggestion ? `Suggestion: ${lower(suggestion)}` : null),
      step: openStep("calls", "See the call"),
      others: uniqueSteps([...lineSteps, openOrder], null),
    }
  }

  return { headline: "Needs your decision", body: null, step: openOrder, others: [] }
}

function confirm(input: SituationInput): Situation {
  const pending = input.publication?.pending ?? []
  const first = pending[0]
  const step: Step = { label: "Approve and publish", do: "confirm" }
  return {
    headline: first ? stop(first.point) : "Call results wait for your yes",
    body: joinBody(first ? `Now: ${lower(stop(first.after))}` : null, pending.length > 1 ? `${pending.length - 1} more ${pending.length === 2 ? "point" : "points"} settled by the calls` : null),
    step,
    others: [openStep("publishing", "Check each rewrite")],
  }
}

/** What the agent is doing: the line it is on, else the planned work. */
function inProgress(input: SituationInput): Situation {
  const line = input.callLines.find((row) => row.status === "calling")
    ?? input.callLines.find((row) => row.status === "callback_due")
    ?? input.callLines.find((row) => row.status === "callback")
    ?? input.callLines.find((row) => row.status === "to_call")
  const topics = (row: CallLineView) => row.open.map((topic) => topic.title).join("; ") || row.latest?.reason || null
  if (line) {
    const name = shortName(line.callee?.name ?? line.callee?.handle)
    const at = line.latest?.callbackAt ? new Date(line.latest.callbackAt).toISOString().slice(11, 16) : null
    const headline = line.status === "calling" ? `Calling ${name}`
      : line.status === "callback_due" ? `Calling ${name} back now`
      : line.status === "callback" ? `Callback to ${name}${at ? ` at ${at} UTC` : ""}`
      : `Will call ${name}`
    return { headline, body: topics(line) ? sentence(topics(line)!) : null, step: null, others: [] }
  }
  const reviewer = input.planned.find((action) => action.kind === "reviewer_pass")
  if (reviewer) return { headline: "Reviewer reads the records", body: reviewer.reason ? clip(sentence(reviewer.reason)) : null, step: null, others: [] }
  const call = input.proposals.find((proposal) => proposal.waitingOn === "agent")
  if (call) return { headline: `Will call ${shortName(call.contact.name)}`, body: sentence(call.title), step: null, others: [] }
  const planned = input.planned[0]
  return { headline: "Agent at work", body: planned?.reason ? clip(sentence(planned.reason)) : null, step: null, others: [] }
}

/** The card for an order in Blocked, Fixed, review it or In progress; null otherwise. */
export function situationFor(input: SituationInput): Situation | null {
  if (input.group === "needs_action") return needsAction(input)
  if (input.group === "solved") return confirm(input)
  if (input.group === "in_progress") return inProgress(input)
  return null
}
