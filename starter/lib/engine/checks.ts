// What the engine says about one order: the rule results, the agent work they
// plan, the group the order is in and how urgent it is. Pure: one bundle, the
// fleet index and the clock in, a verdict out. Later tickets add inputs (reviews,
// proposals, calls) and fold them into `groupOf`.

import type { Bundle } from "@/lib/present/bundle"
import { evaluateRules, type Fleet, type RuleContext } from "./rules"

export type Group = "needs_action" | "in_progress" | "normal" | "done"
export const GROUPS: Group[] = ["needs_action", "in_progress", "normal", "done"]

/** A record a rule read, so the UI can link to it. `collection` is the dataset file name. */
export type SourceRef = { collection: string; id: string; label: string }

/**
 * What a rule asks for first when it fails (or, for a weak rule, when it plans a call):
 * - `site_call` / `driver_call`: a routine tier-1 call, no approval needed;
 * - `reviewer_pass`: the reviewer reads the order's records;
 * - `show_person`: the order goes to Needs action with the evidence.
 */
export type FirstAction = "site_call" | "driver_call" | "reviewer_pass" | "show_person"

/**
 * `pass`: checked and fine. `fail`: the rule fired. `unknown`: it could not be
 * checked (a weak signal, or a strong rule missing its inputs); listed under
 * "couldn't check". Weak rules never fail.
 */
export type Outcome = "pass" | "fail" | "unknown"

export type RuleId = "R1" | "R3" | "R7" | "R10" | "R11" | "R12" | "R13" | "R4" | "R5" | "R6" | "CLOSE"

export type RuleResult = {
  id: RuleId
  strength: "strong" | "weak"
  /** What the rule checks, as a line on the "checked" list. */
  title: string
  outcome: Outcome
  /** What the rule found, in one sentence. */
  detail: string
  /** The first action this rule takes when it fires, or null when it has nothing to do. */
  firstAction: FirstAction | null
  sources: SourceRef[]
}

/** Who a planned call goes to: the order's endpoint contact (never the customer). */
export type Callee = { name: string | null; handle: string; role: string | null; endpointId: string }

/** Agent work the rules planned. Calls are tier 1 and need no approval. */
export type PlannedAction = {
  kind: "site_call" | "driver_call" | "reviewer_pass"
  /** The rules that asked for it. */
  ruleIds: RuleId[]
  reason: string
  callee: Callee | null
}

export type UrgencyReason = "action_due" | "promise_at_risk" | "pickup_unready"

export type Urgency = {
  urgent: boolean
  reasons: { kind: UrgencyReason; text: string; at: string | null }[]
  /** The earliest deadline the rules know of (pickup, promise, due check), for ranking. */
  dueAt: string | null
}

export type Verdict = {
  group: Group
  /** One line: why the order is in Needs action or In progress; what was checked otherwise. */
  reason: string
  rules: RuleResult[]
  planned: PlannedAction[]
  urgency: Urgency
}

export function verdictFor(bundle: Bundle, context: RuleContext): Verdict {
  const { rules, planned, urgency, finished } = evaluateRules(bundle, context)
  const decisions = rules.filter((row) => row.outcome === "fail" && row.firstAction === "show_person")
  if (decisions.length) {
    return { group: "needs_action", reason: decisions.map((row) => row.detail).join(" "), rules, planned, urgency }
  }
  if (planned.length) {
    return { group: "in_progress", reason: planned.map((action) => action.reason).join(" "), rules, planned, urgency }
  }
  const gaps = rules.filter((row) => row.outcome === "unknown").length
  if (finished && gaps === 0) return { group: "done", reason: "Finished with nothing open.", rules, planned, urgency }
  const checked = rules.length
  return {
    group: "normal",
    reason: gaps ? `The rules found nothing to act on; ${gaps === 1 ? "one gap" : `${gaps} gaps`} couldn't be checked.` : `All ${checked} checks passed.`,
    rules, planned, urgency,
  }
}

const URGENT_FIRST = (a: Urgency, b: Urgency) => Number(b.urgent) - Number(a.urgent)
  || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9")

/** Needs action order: urgent first, then the soonest deadline, then by reference. */
export function compareUrgency(a: { urgency: Urgency; reference: string }, b: { urgency: Urgency; reference: string }): number {
  return URGENT_FIRST(a.urgency, b.urgency) || a.reference.localeCompare(b.reference)
}

export type { Fleet, RuleContext }
