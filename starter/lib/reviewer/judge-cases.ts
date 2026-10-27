// The judge's own eval (spec .scratch/self-improving-agents, step 4): hand-written
// corrections and new reviews with the verdict a careful engineer would give.
// `npm run lessons:judge-eval` asks the real judge and records its replies in
// fixtures/judge/replies.json; the tests replay them (judge.test.ts).

import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { JUDGE_SYSTEM, type JudgeCase, type Verdict } from "./judge"
import type { ContactType } from "./policy"
import type { Reviewed } from "./reviewer"

type NewFinding = { title: string; contactType: ContactType; name: string; question: string; why?: string }

/** `expected`: the verdicts that are right. Only "fixed" counts in the gate, so "repeats" and "unclear" may both be right. */
export type JudgeEvalCase = JudgeCase & { id: string; findings: NewFinding[]; expected: Verdict[] }

const WRONG_PERSON: JudgeCase = {
  correction: "The agent asked the customer support desk who may sign for the car, but that decision belongs to the receiving site, so the question should have gone to the site.",
  agentSaid: { title: "No confirmed authorised receiver for the delivery", question: "Is Celia Hollowmere authorised to receive and sign for the car?", asked: "Paying customer: Calverona Auto" },
}
const SETTLED: JudgeCase = {
  correction: "The agent asked the customer who may sign, but the operator had already settled it with the customer by phone.",
  agentSaid: { title: "No authorised receiver named", question: "Who at Calverona Auto may sign for the car?", asked: "Paying customer: Calverona Auto" },
}
const EDITED: JudgeCase = {
  correction: 'The operator kept the proposal but changed the question from "Is the car ready?" to "Is the car ready with both keys at the Lahti branch by 10:30?".',
  agentSaid: { title: "Pickup readiness unconfirmed", question: "Is the car ready?", asked: "Third-party site or seller: Auvelloria Lahti" },
}

export const JUDGE_CASES: JudgeEvalCase[] = [
  { id: "wrong-person-still-customer", ...WRONG_PERSON, expected: ["repeats"],
    findings: [{ title: "No confirmed authorised receiver for the delivery", contactType: "paying_customer", name: "Calverona Auto", question: "Who is authorised to sign for the car at the delivery address?" }] },
  { id: "wrong-person-now-site", ...WRONG_PERSON, expected: ["fixed"],
    findings: [{ title: "No confirmed authorised receiver for the delivery", contactType: "third_party_site", name: "Munich handoff front desk", question: "Who at your desk is authorised to receive and sign for the car today?" }] },
  { id: "wrong-person-silent", ...WRONG_PERSON, expected: ["repeats", "unclear"], findings: [] },
  { id: "settled-silent", ...SETTLED, expected: ["fixed"], findings: [] },
  { id: "settled-asked-again", ...SETTLED, expected: ["repeats"],
    findings: [{ title: "Receiver authority unclear", contactType: "paying_customer", name: "Calverona Auto", question: "Can you confirm who may sign for the car on delivery?" }] },
  { id: "settled-other-issue", ...SETTLED, expected: ["fixed"],
    findings: [{ title: "Driver ETA after the delivery window", contactType: "driver", name: "the driver", question: "Can you still reach the delivery address before 18:00?" }] },
  { id: "edit-carried", ...EDITED, expected: ["fixed"],
    findings: [{ title: "Pickup readiness unconfirmed", contactType: "third_party_site", name: "Auvelloria Lahti", question: "Is the car ready with both keys at the Lahti branch by 10:30?" }] },
  { id: "edit-dropped", ...EDITED, expected: ["repeats"],
    findings: [{ title: "Pickup readiness unconfirmed", contactType: "third_party_site", name: "Auvelloria Lahti", question: "Is the car ready for pickup?" }] },
]

/** A case's new review, as the reviewer would return it. */
export function judgeEvalReview(item: JudgeEvalCase): Reviewed {
  return {
    status: "reviewed", orderId: "ord-judge", reference: item.id, hash: "judge", summary: "",
    findings: item.findings.map((finding) => ({
      title: finding.title, conflict: [], whoPays: "", policyRow: "customer-side", repaired: false, question: finding.question, why: finding.why ?? "",
      ask: { role: finding.contactType === "driver" ? "driver" : finding.contactType.endsWith("site") ? "site" : "customer", contactType: finding.contactType, contactRecordId: "rec", contactQuote: "", name: finding.name },
    })),
  } as unknown as Reviewed
}

/** `promptHash`: the judge's system prompt the replies answer; a changed prompt needs a new recording. */
export type JudgeReplies = { model: string | null; recordedAt: string | null; promptHash: string; replies: Record<string, string> }

export const judgePromptHash = () => createHash("sha256").update(JUDGE_SYSTEM).digest("hex").slice(0, 16)

export const JUDGE_REPLIES = join(process.cwd(), "lib", "reviewer", "fixtures", "judge", "replies.json")

export async function loadJudgeReplies(): Promise<JudgeReplies | null> {
  try {
    return JSON.parse(await readFile(JUDGE_REPLIES, "utf8")) as JudgeReplies
  } catch {
    return null
  }
}

export async function writeJudgeReplies(replies: JudgeReplies): Promise<void> {
  await writeFile(JUDGE_REPLIES, `${JSON.stringify(replies, null, 2)}\n`)
}
