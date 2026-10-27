// The reviewer eval: runs the real model on the 7 cases from the spec, prints a score
// against the expected findings (lib/reviewer/score.ts) and records each order's
// replies as fixtures in lib/reviewer/fixtures/cases/, which tests replay offline.
// The score is a report, not a gate.
//
//   npm run review:eval              real model; needs ANTHROPIC_API_KEY
//   npm run review:eval -- --replay  score the committed fixtures offline
//   npm run review:eval -- --dry     real model, but do not write fixtures
//
// DATASET_DIR re-runs it on modified data. REVIEWER_MODEL overrides the model.
// Behind an HTTPS proxy, set NODE_USE_ENV_PROXY=1 so Node's fetch uses it.

import "dotenv/config"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { CASE_FIXTURE_DIR, loadFixtures, writeFixture } from "../lib/reviewer/fixtures"
import { anthropicFromEnv } from "../lib/reviewer/anthropic"
import { formatReview, formatScore } from "../lib/reviewer/report"
import { createReviewer, type ReviewResult } from "../lib/reviewer/reviewer"
import { createRecordingGateway, createScriptedGateway } from "../lib/reviewer/scripted"
import { EXPECTED_CASES, scoreRun } from "../lib/reviewer/score"
import { reviewSourceFromFiles } from "../lib/reviewer/source"

async function main(): Promise<void> {
  const replay = process.argv.includes("--replay")
  const dry = process.argv.includes("--dry")
  const source = await reviewSourceFromFiles()
  const now = source.snapshot.snapshotAt

  if (replay) {
    const fixtures = await loadFixtures()
    const reviewer = createReviewer({ gateway: createScriptedGateway(fixtures), source })
    const results: ReviewResult[] = []
    for (const item of EXPECTED_CASES) results.push(await reviewer.review(item.reference, { now }))
    const origins = [...new Set(fixtures.map((fixture) => fixture.origin))].join(", ")
    console.log(`Replaying committed fixtures (${origins}); costs are as recorded.\n`)
    console.log(formatScore(scoreRun(results)))
    return
  }

  const real = anthropicFromEnv()
  if (!real) {
    console.error("ANTHROPIC_API_KEY is not set: the reviewer eval needs the real model.")
    console.error("Run `npm run review:eval -- --replay` to score the committed fixtures offline.")
    process.exit(2)
  }
  const gateway = createRecordingGateway(real)
  const reviewer = createReviewer({ gateway, source })
  const results: ReviewResult[] = []
  for (const item of EXPECTED_CASES) {
    const result = await reviewer.review(item.reference, { now })
    results.push(result)
    console.log(formatReview(result))
    console.log("")
    const turns = gateway.turns(item.reference)
    if (!dry && result.status === "reviewed" && turns.length) {
      const path = await writeFixture({
        reference: item.reference,
        origin: "recorded",
        note: `Recorded by the reviewer eval (${item.expectation})`,
        model: result.model,
        recordedAt: new Date().toISOString(),
        caseFileHash: result.hash,
        turns,
      })
      console.log(`  recorded ${path}\n`)
    } else if (!dry) {
      console.log(`  ${item.reference}: not recorded (${result.status === "not_reviewed" ? result.reason : "no turns"}); the old fixture stays\n`)
    }
  }
  const run = scoreRun(results)
  console.log(formatScore(run))
  if (!dry) {
    const report = join(CASE_FIXTURE_DIR, "..", "last-run.json")
    await writeFile(report, `${JSON.stringify({ ranAt: new Date().toISOString(), now, ...run }, null, 2)}\n`)
    console.log(`Score written to ${report}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
