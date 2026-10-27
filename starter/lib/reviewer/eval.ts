// The reviewer eval as a function: the spec's cases (score.ts) and, for the lessons
// gate (lib/engine/distil.ts), learned cases built from the operator's corrections.
// `npm run review:eval` and the gate both run it. Each run gets a fresh reviewer with
// its own memory cache, so a second run asks the model again.
//
// - Learned cases are scored beside the spec's cases; they never change or replace one.
// - A learned case is a kept case file and its correction: the reviewer reviews the file
//   again and the judge (judge.ts) says whether the new review repeats the mistake.
//   Only "fixed" counts.

import type { CaseFile, RuleResult } from "./case-file"
import type { ModelGateway } from "./gateway"
import { judge, type JudgeCase, type Verdict } from "./judge"
import type { InjectedLesson } from "./lessons"
import { createReviewer, DEFAULT_REVIEWER_MODEL, type ReviewResult, type Reviewer } from "./reviewer"
import { EXPECTED_CASES, scoreRun, type RunScore } from "./score"
import type { ReviewSource } from "./source"

/** One source mistake as an eval case: its kept case file and its correction. */
export type LearnedCase = JudgeCase & { mistakeId: string; file: CaseFile }

export type LearnedScore = { mistakeId: string; reference: string; verdict: Verdict; reason: string; cost: number }

export type EvalRun = {
  existing: RunScore
  learned: LearnedScore[]
  /** Learned cases the judge called "fixed". */
  fixed: number
  cost: number
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
  /** The judge's model; default the reviewer's. */
  judgeModel?: string
  rulesFor?: (reference: string) => RuleResult[]
}

/** One eval run: the spec's cases at the snapshot time, then each learned case on its kept case file, judged. */
export async function runEval(options: EvalOptions): Promise<EvalRun> {
  const lessons = options.lessons ?? []
  const model = options.model
  const reviewer = createReviewer({ gateway: options.gateway, source: options.source, model, lessons: async () => lessons })
  const existing = scoreRun(await reviewExpected(reviewer, options.source.snapshot.snapshotAt, { rulesFor: options.rulesFor }))
  const learned: LearnedScore[] = []
  for (const item of options.learned ?? []) {
    const result = await reviewer.reviewFile(item.file)
    const judged = await judge(options.gateway, options.judgeModel ?? model ?? process.env.REVIEWER_MODEL ?? DEFAULT_REVIEWER_MODEL, item, result, item.mistakeId)
    learned.push({ mistakeId: item.mistakeId, reference: item.file.reference, verdict: judged.verdict, reason: judged.reason, cost: result.cost + judged.cost })
  }
  return {
    existing, learned,
    fixed: learned.filter((row) => row.verdict === "fixed").length,
    cost: existing.cost + learned.reduce((total, row) => total + row.cost, 0),
  }
}
