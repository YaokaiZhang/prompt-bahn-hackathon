// The reviewer eval as a function: the spec's cases (score.ts) and, for the lessons
// gate (lib/engine/distil.ts), learned cases built from the operator's corrections.
// `npm run review:eval` and the gate both run it. Each run gets a fresh reviewer with
// its own memory cache, so a second run asks the model again.
//
// - Learned cases are scored beside the spec's cases; they never change or replace one.
// - A learned case is a kept case file plus what its correction makes checkable:
//     not-raised (a dismissal): no finding raises the dismissed one again, i.e. none has
//       its title (normalised) or cites at least half of its conflict records. 1 point.
//     same-contact (an edit: the ask was right, its wording was not): a finding still
//       asks the same role via the same contact record, 1 point; when the edit added
//       numbers or names, that finding's question carries every one of them, 1 point.
//   A case that was not reviewed scores 0.
// - Fractions are points / max; `overall` pools the spec's and the learned cases' points.

import type { CaseFile, RuleResult } from "./case-file"
import type { ModelGateway } from "./gateway"
import type { InjectedLesson } from "./lessons"
import type { AskRole } from "./policy"
import { createReviewer, type ReviewResult, type Reviewer } from "./reviewer"
import { EXPECTED_CASES, scoreRun, type Check, type RunScore } from "./score"
import type { ReviewSource } from "./source"
import { normaliseText, type Finding } from "./validate"

export type LearnedExpectation =
  | { kind: "not-raised"; title: string; conflictIds: string[] }
  | { kind: "same-contact"; role: AskRole; contactRecordId: string | null; added: string[] }

/** One source mistake as an eval case: its kept case file and what must hold on it. */
export type LearnedCase = { mistakeId: string; file: CaseFile; expect: LearnedExpectation }

export type LearnedScore = { mistakeId: string; reference: string; points: number; max: number; checks: Check[]; cost: number }

export type EvalRun = {
  existing: RunScore
  learned: LearnedScore[]
  /** points / max of the spec's cases. */
  existingFraction: number
  /** points / max of the learned cases; null without any. */
  learnedFraction: number | null
  overallFraction: number
  cost: number
}

/** Numbers and mid-sentence capitalised words in `after` that `before` lacks: what the operator's edit added. */
export function editAdditions(before: string, after: string): string[] {
  const lower = before.toLowerCase()
  const numbers = after.match(/\d+/g) ?? []
  const names = [...after.matchAll(/(?<![.!?]\s|^)\b[A-Z][\w'-]*/g)].map((match) => match[0])
  return [...new Set([...numbers, ...names])].filter((word) => !lower.includes(word.toLowerCase()))
}

function raises(finding: Finding, expect: Extract<LearnedExpectation, { kind: "not-raised" }>): boolean {
  if (normaliseText(finding.title) === normaliseText(expect.title)) return true
  if (!expect.conflictIds.length) return false
  const cited = new Set(finding.conflict.map((item) => item.recordId))
  return expect.conflictIds.filter((id) => cited.has(id)).length * 2 >= expect.conflictIds.length
}

export function scoreLearned(item: LearnedCase, result: ReviewResult): LearnedScore {
  const base = { mistakeId: item.mistakeId, reference: item.file.reference, cost: result.cost }
  const { expect } = item
  const names = expect.kind === "not-raised" ? ["not raised again"] : ["same contact", ...(expect.added.length ? ["edit's additions"] : [])]
  if (result.status !== "reviewed") return { ...base, points: 0, max: names.length, checks: names.map((name) => ({ name, pass: false, detail: result.reason })) }
  let checks: Check[]
  if (expect.kind === "not-raised") {
    const again = result.findings.find((finding) => raises(finding, expect))
    checks = [{ name: names[0], pass: !again, detail: again ? `raised again: ${again.title}` : `${result.findings.length} other finding(s)` }]
  } else {
    const same = result.findings.find((finding) => finding.ask.role === expect.role && (!expect.contactRecordId || finding.ask.contactRecordId === expect.contactRecordId))
    checks = [{ name: "same contact", pass: !!same, detail: same ? `${same.ask.role} via ${same.ask.contactRecordId}` : `no finding asks ${expect.role}` }]
    if (expect.added.length) {
      const question = (same?.question ?? "").toLowerCase()
      const missing = expect.added.filter((word) => !question.includes(word.toLowerCase()))
      checks.push({ name: "edit's additions", pass: !!same && !missing.length, detail: missing.length ? `missing ${missing.join(", ")}` : expect.added.join(", ") })
    }
  }
  return { ...base, checks, points: checks.filter((check) => check.pass).length, max: checks.length }
}

/** Reviews the spec's cases at `now`, one by one; `rulesFor` adds each order's rule results. */
export async function reviewExpected(reviewer: Reviewer, now: string, options: { rulesFor?: (reference: string) => RuleResult[]; onResult?: (result: ReviewResult) => Promise<void> | void } = {}): Promise<ReviewResult[]> {
  const results: ReviewResult[] = []
  for (const item of EXPECTED_CASES) {
    const result = await reviewer.review(item.reference, { now, ...(options.rulesFor ? { rules: options.rulesFor(item.reference) } : {}) })
    results.push(result)
    await options.onResult?.(result)
  }
  return results
}

export type EvalOptions = {
  gateway: ModelGateway
  source: ReviewSource
  model?: string
  /** The lessons to inject (the candidate); absent: none. */
  lessons?: InjectedLesson[]
  learned?: LearnedCase[]
  rulesFor?: (reference: string) => RuleResult[]
}

/** One eval run: the spec's cases at the snapshot time, then each learned case on its kept case file. */
export async function runEval(options: EvalOptions): Promise<EvalRun> {
  const lessons = options.lessons ?? []
  const reviewer = createReviewer({ gateway: options.gateway, source: options.source, model: options.model, lessons: async () => lessons })
  const existing = scoreRun(await reviewExpected(reviewer, options.source.snapshot.snapshotAt, { rulesFor: options.rulesFor }))
  const learned: LearnedScore[] = []
  for (const item of options.learned ?? []) learned.push(scoreLearned(item, await reviewer.reviewFile(item.file)))
  const sum = (rows: { points: number; max: number }[], key: "points" | "max") => rows.reduce((total, row) => total + row[key], 0)
  const learnedMax = sum(learned, "max")
  return {
    existing, learned,
    existingFraction: existing.max ? existing.points / existing.max : 0,
    learnedFraction: learnedMax ? sum(learned, "points") / learnedMax : null,
    overallFraction: (existing.points + sum(learned, "points")) / Math.max(1, existing.max + learnedMax),
    cost: existing.cost + learned.reduce((total, row) => total + row.cost, 0),
  }
}
