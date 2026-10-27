// The judge's eval, offline: the hand-written cases (judge-cases.ts) against the real
// judge's replies as `npm run lessons:judge-eval` recorded them.

import assert from "node:assert/strict"
import { test } from "node:test"
import { NO_USAGE, type ModelGateway } from "./gateway"
import { editCorrection, judge, parseNeeded } from "./judge"
import { JUDGE_CASES, judgeEvalReview, judgePromptHash, loadJudgeReplies } from "./judge-cases"

test("the recorded judge gives the expected verdict on every hand-written case, for the current prompt", async () => {
  const recorded = await loadJudgeReplies()
  assert.ok(recorded, "record the judge's replies: npm run lessons:judge-eval")
  assert.equal(recorded.promptHash, judgePromptHash(), "the judge's prompt changed: record again with npm run lessons:judge-eval")
  const gateway: ModelGateway = { chat: async (request) => ({ model: "recorded", finishReason: "stop", usage: NO_USAGE, message: { role: "assistant", content: recorded.replies[request.subject] ?? null } }) }
  for (const item of JUDGE_CASES) {
    const judged = await judge(gateway, "recorded", item, judgeEvalReview(item), item.id)
    assert.ok(item.expected.includes(judged.verdict), `${item.id}: ${judged.verdict}. ${judged.reason}`)
  }
})

test("a review that did not complete is unclear without asking the judge; a failed call is unclear", async () => {
  const [item] = JUDGE_CASES
  let asked = 0
  const failing: ModelGateway = { chat: async () => { asked += 1; throw new Error("down") } }
  const notReviewed = { status: "not_reviewed", orderId: "o", reference: "r", hash: "h", reason: "not reviewed yet: no key", recordsRead: 0, cost: 0 } as const
  assert.deepEqual(await judge(failing, "m", item, notReviewed, item.id), { verdict: "unclear", reason: "not reviewed yet: no key", cost: 0 })
  assert.equal(asked, 0)
  assert.equal((await judge(failing, "m", item, judgeEvalReview(item), item.id)).verdict, "unclear")
})

test("an edit names only the words the operator changed", () => {
  assert.equal(editCorrection("Is the car ready?", "Is the car ready? Please reply by 12:00 today."),
    'The operator kept the proposal, its contact and its conflict, and changed only the question from "Is the car ready?" to "Is the car ready? Please reply by 12:00 today.". Added: "Please reply by 12:00 today.".')
  assert.match(editCorrection("Can you sign today?", "Can you sign tomorrow?"), /Removed: "today\?"\. Added: "tomorrow\?"\.$/)
})

test("a review with no findings asks only whether the conflict still needed raising; code makes the verdict", async () => {
  const asked: string[] = []
  const gateway = (reply: string): ModelGateway => ({ chat: async (request) => { asked.push(request.messages[0].content as string); return { model: "m", finishReason: "stop", usage: NO_USAGE, message: { role: "assistant", content: reply } } } })
  const silent = JUDGE_CASES.find((item) => item.id === "wrong-person-silent")!
  assert.equal((await judge(gateway('{"needed": true, "reason": "ask the site"}'), "m", silent, judgeEvalReview(silent), "s")).verdict, "repeats")
  assert.equal((await judge(gateway('{"needed": false, "reason": "settled"}'), "m", silent, judgeEvalReview(silent), "s")).verdict, "fixed")
  assert.ok(asked.every((prompt) => prompt.startsWith("An operator corrected")))
  assert.equal(parseNeeded('{"needed": "yes", "reason": "x"}').verdict, "unclear")
  assert.equal(parseNeeded('{"needed": null, "reason": "x"}').verdict, "unclear")
})
