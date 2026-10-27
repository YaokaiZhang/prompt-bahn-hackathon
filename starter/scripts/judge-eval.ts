// The judge's eval: asks the real judge about the hand-written cases in
// lib/reviewer/judge-cases.ts, prints each verdict against the expected one and records
// the replies in lib/reviewer/fixtures/judge/replies.json, which the tests replay.
//
//   npm run lessons:judge-eval              real model; needs ANTHROPIC_API_KEY
//   npm run lessons:judge-eval -- --replay  score the recorded replies offline
//   npm run lessons:judge-eval -- --dry     real model, but do not record
//
// REVIEWER_MODEL overrides the judge's model (the agents' own). Behind an HTTPS proxy,
// set NODE_USE_ENV_PROXY=1.

import "dotenv/config"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { anthropicFromEnv } from "../lib/reviewer/anthropic"
import { NO_USAGE, type ModelGateway } from "../lib/reviewer/gateway"
import { judge } from "../lib/reviewer/judge"
import { JUDGE_CASES, JUDGE_REPLIES, judgeEvalReview, judgePromptHash, loadJudgeReplies, writeJudgeReplies } from "../lib/reviewer/judge-cases"
import { DEFAULT_REVIEWER_MODEL } from "../lib/reviewer/reviewer"
import { money } from "../lib/reviewer/report"

async function main(): Promise<void> {
  const replay = process.argv.includes("--replay")
  const dry = process.argv.includes("--dry")
  const model = process.env.REVIEWER_MODEL ?? DEFAULT_REVIEWER_MODEL
  const recorded = replay ? await loadJudgeReplies() : null
  if (replay && !recorded) throw new Error(`No recorded replies at ${JUDGE_REPLIES}. Run without --replay first.`)
  if (recorded && recorded.promptHash !== judgePromptHash()) console.log("The judge's prompt changed since these replies were recorded: run without --replay to record again.\n")
  const real = replay ? null : anthropicFromEnv()
  if (!replay && !real) {
    console.error("ANTHROPIC_API_KEY is not set: the judge eval needs the model. Use --replay for the recorded replies.")
    process.exit(2)
  }
  const replies: Record<string, string> = {}
  const gateway: ModelGateway = {
    async chat(request) {
      if (recorded) return { model: recorded.model ?? "recorded", finishReason: "stop", usage: NO_USAGE, message: { role: "assistant", content: recorded.replies[request.subject] ?? null } }
      const response = await real!.chat(request)
      replies[request.subject] = response.message.content ?? ""
      return response
    },
  }
  let right = 0
  let cost = 0
  for (const item of JUDGE_CASES) {
    const judged = await judge(gateway, model, item, judgeEvalReview(item), item.id)
    cost += judged.cost
    const ok = item.expected.includes(judged.verdict)
    if (ok) right += 1
    console.log(`${ok ? "ok  " : "MISS"} ${item.id}: ${judged.verdict} (expected ${item.expected.join(" or ")}). ${judged.reason}`)
  }
  console.log(`\nJudge ${right}/${JUDGE_CASES.length}; model cost ${money(cost)}${replay ? " (replayed)" : ""}`)
  if (!replay && !dry) {
    await mkdir(dirname(JUDGE_REPLIES), { recursive: true })
    await writeJudgeReplies({ model, recordedAt: new Date().toISOString(), promptHash: judgePromptHash(), replies })
    console.log(`Recorded the replies in ${JUDGE_REPLIES}.`)
  }
  if (right < JUDGE_CASES.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
