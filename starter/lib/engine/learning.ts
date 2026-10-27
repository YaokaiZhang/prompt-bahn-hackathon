// The lessons trigger (spec .scratch/self-improving-agents, ticket 03): when a usable
// mistake is recorded, check its groups (distil.ts) and, when one qualifies, distil
// and gate it in the background. `npm run lessons` runs the same step by hand.
//
// - Never blocks the request that recorded the mistake: `consider` returns at once.
// - One run at a time in the process: the groups of a mistake that arrives during a run
//   are checked once that run ends.
// - Each group at most once per hour (any run started for it, whatever came of it).
// - A daily spend cap (LESSONS_DAILY_USD, default 2) summed from the gateway's response
//   costs of today's runs (UTC, real time). Runs are stored (cr_distil_runs), so a
//   restart neither resets the spend nor the cooldown. A call that would start past the
//   cap is refused and the run ends "failed".
// - A run first restates mistakes left pending (no key when they were recorded).
// - Without a gateway: nothing happens.

import { randomUUID } from "node:crypto"
import type { RuleResult } from "@/lib/reviewer/case-file"
import { GatewayError, type ModelGateway } from "@/lib/reviewer/gateway"
import { DEFAULT_LESSONS_MODEL, DEFAULT_REVIEWER_MODEL } from "@/lib/reviewer/reviewer"
import type { ReviewSource } from "@/lib/reviewer/source"
import {
  distil, DistilRejected, groupHistory, groupKeys, groupMistakes, learnedCases, qualifies, runGate, toCandidate,
  type Distilled, type DistilOutcome, type DistilRun, type GateResult, type MistakeGroup,
} from "./distil"
import { addLessonCandidate, LessonRefused, lessonId, readLessons } from "./lessons"
import { restatePending, type Mistake } from "./mistakes"
import { toReviewerRules } from "./reviews"
import { buildFleet, evaluateRules } from "./rules"
import type { EngineStore } from "./store"

export const LESSONS_COOLDOWN_MS = 60 * 60_000
export const DEFAULT_LESSONS_DAILY_USD = 2

export type LearningOptions = {
  store: EngineStore
  /** null: no key, nothing is learned. */
  gateway: ModelGateway | null
  source: ReviewSource
  /** The demo clock, for the candidate's Briefing item. */
  now: () => Promise<string>
  /** The distiller's model; default LESSONS_MODEL or DEFAULT_LESSONS_MODEL. */
  model?: string
  /** The agents' own model (gate and restatements); default REVIEWER_MODEL or DEFAULT_REVIEWER_MODEL. */
  agentModel?: string
  /** Default LESSONS_DAILY_USD or 2. */
  dailyUsd?: number
  cooldownMs?: number
  /** Real time. */
  clock?: () => Date
  /** Rule results for the eval's spec cases; default: the rules at the snapshot time, as the app passes them. */
  rulesFor?: (reference: string) => RuleResult[]
  log?: (line: string) => void
}

export type DistilReport = {
  group: string
  outcome: DistilOutcome | "skipped"
  detail: string
  cost: number
  distilled?: Distilled | null
  gate?: GateResult
  lessonId?: string
}

export type Learning = {
  /** A usable mistake was recorded: checks its groups and starts a run in the background when one qualifies. Never throws or waits. */
  consider(mistake: Mistake): void
  /** The same step by hand, on every group (`npm run lessons`); `dry`: distil and check only, no eval, nothing stored. */
  runNow(options?: { dry?: boolean }): Promise<DistilReport[]>
  /** Resolves when the background run (if any) has finished (tests and scripts). */
  settled(): Promise<void>
}

class CapReached extends GatewayError {}

/** Each order's rule results at the snapshot time, in the reviewer's shape: what the app's reviews read. */
export function rulesAtSnapshot(source: ReviewSource): (reference: string) => RuleResult[] {
  const fleet = buildFleet(source.snapshot.bundles)
  const now = source.snapshot.snapshotAt
  const known = new Map<string, RuleResult[]>()
  return (reference) => {
    if (!known.has(reference)) {
      const bundle = source.snapshot.bundles.find((row) => row.order.reference === reference || row.order.id === reference)
      known.set(reference, bundle ? toReviewerRules(evaluateRules(bundle, { now, fleet }).rules) : [])
    }
    return known.get(reference)!
  }
}

/** Today's spend (UTC day of `now`) over the stored runs. */
export function spentOn(runs: DistilRun[], now: Date): number {
  const day = now.toISOString().slice(0, 10)
  return runs.filter((run) => run.startedAt.slice(0, 10) === day).reduce((sum, run) => sum + run.cost, 0)
}

export function createLearning(options: LearningOptions): Learning {
  const { store, gateway, source } = options
  const model = options.model ?? process.env.LESSONS_MODEL ?? DEFAULT_LESSONS_MODEL
  const agentModel = options.agentModel ?? process.env.REVIEWER_MODEL ?? DEFAULT_REVIEWER_MODEL
  const envCap = Number(process.env.LESSONS_DAILY_USD)
  const cap = options.dailyUsd ?? (Number.isFinite(envCap) && process.env.LESSONS_DAILY_USD ? envCap : DEFAULT_LESSONS_DAILY_USD)
  const cooldown = options.cooldownMs ?? LESSONS_COOLDOWN_MS
  const clock = options.clock ?? (() => new Date())
  const rulesFor = options.rulesFor ?? rulesAtSnapshot(source)
  const log = options.log ?? ((line: string) => console.log(`lessons: ${line}`))
  const capMessage = `the daily lessons spend cap ($${cap}) is reached`
  let running: Promise<unknown> | null = null
  /** Groups to check once the current run ends. */
  const queued = new Set<string>()

  /** The gateway, counting what each response cost and refusing a call once today's spend reaches the cap. */
  function metered(inner: ModelGateway, spentBefore: number) {
    let spent = 0
    let refused = false
    return {
      spent: () => spent,
      over: () => spentBefore + spent >= cap,
      /** True once a call was refused: an eval with refused reviews says nothing, so the run fails. */
      refused: () => refused,
      gateway: {
        async chat(request) {
          if (spentBefore + spent >= cap) {
            refused = true
            throw new CapReached(capMessage)
          }
          const response = await inner.chat(request)
          spent += response.usage.cost
          return response
        },
      } satisfies ModelGateway,
    }
  }

  function cooling(key: string, runs: DistilRun[]): boolean {
    const since = clock().getTime() - cooldown
    return runs.some((run) => run.group === key && run.outcome !== "restated" && new Date(run.startedAt).getTime() > since)
  }

  async function runGroup(group: MistakeGroup, all: Mistake[], meter: ReturnType<typeof metered>, dry: boolean): Promise<DistilReport> {
    const id = `dst-${randomUUID()}`
    const startCost = meter.spent()
    const run: DistilRun = { id, group: group.key, startedAt: clock().toISOString(), finishedAt: null, outcome: "running", lessonId: null, mistakeIds: [], cost: 0, detail: "" }
    if (!dry) await store.startDistilRun(run)
    let report: DistilReport
    let mistakeIds: string[] = []
    try {
      const { distilled, input } = await distil(meter.gateway, model, group, all)
      mistakeIds = input.mistakes.map((row) => row.id)
      if (!distilled) report = { group: group.key, outcome: "no-lesson", detail: "the distiller found nothing the mistakes share", cost: 0, distilled }
      else {
        toCandidate(distilled, { before: null, after: null })
        if (dry) report = { group: group.key, outcome: "candidate", detail: "dry run: checked, not evaluated or stored", cost: 0, distilled }
        else {
          const sources = group.mistakes.filter((mistake) => distilled.mistakeIds.includes(mistake.id))
          const lesson = { id: lessonId("reviewer", distilled.lesson), text: distilled.lesson, appliesTo: distilled.appliesTo }
          const gate = await runGate({ gateway: meter.gateway, source, model: agentModel, lesson, learned: learnedCases(sources), rulesFor })
          if (meter.refused()) throw new CapReached(capMessage)
          if (!gate.keep) report = { group: group.key, outcome: "dropped", detail: gate.reason, cost: 0, distilled, gate }
          else {
            const stored = await addLessonCandidate(store, toCandidate(distilled, { before: gate.before.overall, after: gate.after.overall }), { now: await options.now() })
            report = { group: group.key, outcome: "candidate", detail: gate.reason, cost: 0, distilled, gate, lessonId: stored.id }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const invalid = error instanceof DistilRejected || error instanceof LessonRefused
      report = { group: group.key, outcome: invalid ? "invalid" : "failed", detail: invalid ? `rejected: ${message}` : message, cost: 0 }
    }
    report.cost = meter.spent() - startCost
    if (!dry) {
      await store.finishDistilRun(id, {
        finishedAt: clock().toISOString(), outcome: report.outcome as DistilOutcome, lessonId: report.lessonId ?? null, mistakeIds, cost: report.cost, detail: report.detail,
      })
    }
    log(`${group.key}: ${report.outcome} (${report.detail}); $${report.cost.toFixed(4)}`)
    return report
  }

  /** Restates pending mistakes, then runs every group `pick` names that qualifies, is not cooling down and fits the cap. */
  async function step(pick: (group: MistakeGroup) => boolean, dry: boolean): Promise<DistilReport[]> {
    if (!gateway) return []
    const runs = await store.readDistilRuns()
    const meter = metered(gateway, spentOn(runs, clock()))
    const reports: DistilReport[] = []
    if (meter.over()) {
      log(`the daily spend cap ($${cap}) is reached; nothing runs today`)
      return [{ group: "*", outcome: "skipped", detail: "daily spend cap reached", cost: 0 }]
    }
    if (!dry) {
      const restated = await restatePending(store, meter.gateway, agentModel, meter.over)
      if (restated.length) {
        const cost = meter.spent()
        await store.startDistilRun({
          id: `dst-${randomUUID()}`, group: "restate", startedAt: clock().toISOString(), finishedAt: clock().toISOString(), outcome: "restated",
          lessonId: null, mistakeIds: restated.map((mistake) => mistake.id), cost, detail: `${restated.length} pending mistake(s) restated`,
        })
      }
    }
    const all = await store.readMistakes()
    const lessons = await readLessons(store)
    for (const group of groupMistakes(all).filter(pick)) {
      const check = qualifies(group, groupHistory(group.key, runs, lessons))
      if (!check.ok) { reports.push({ group: group.key, outcome: "skipped", detail: check.reason, cost: 0 }); continue }
      if (!dry && cooling(group.key, runs)) { reports.push({ group: group.key, outcome: "skipped", detail: "ran within the last hour", cost: 0 }); continue }
      if (meter.over()) { reports.push({ group: group.key, outcome: "skipped", detail: "daily spend cap reached", cost: 0 }); continue }
      reports.push(await runGroup(group, all, meter, dry))
    }
    return reports
  }

  function exclusive<T>(work: () => Promise<T>): Promise<T> | null {
    if (running) return null
    const job = work().finally(() => { running = null })
    running = job
    return job
  }

  return {
    consider(mistake) {
      if (!gateway || mistake.status !== "usable") return
      for (const key of groupKeys(mistake)) queued.add(key)
      const job = exclusive(async () => {
        while (queued.size) {
          const keys = new Set(queued)
          queued.clear()
          await step((group) => keys.has(group.key), false)
        }
      })
      job?.catch((error) => console.error("lessons:", error instanceof Error ? error.message : error))
    },
    async runNow({ dry = false } = {}) {
      if (!gateway) throw new Error("ANTHROPIC_API_KEY is not set: lessons need the model.")
      const job = exclusive(() => step(() => true, dry))
      if (!job) throw new Error("A lessons run is already going in this process.")
      return job
    },
    async settled() {
      while (running) await running.catch(() => {})
    },
  }
}
