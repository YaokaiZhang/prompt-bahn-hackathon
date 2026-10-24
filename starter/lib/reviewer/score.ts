// The reviewer eval's expected findings (PRD §6.5) and its scoring. The score is a
// report, not a pass/fail gate: for each case it checks the cited records, the
// contact and role, the approval classification (policy row) and no re-asking.

import type { AskRole, PolicyRowId } from "./policy"
import type { ReviewResult } from "./reviewer"
import type { Finding } from "./validate"

export type ExpectedCase = {
  reference: string
  /** What the PRD says, for the report. */
  expectation: string
} & (
  | { kind: "ask"; roles: AskRole[]; conflictGroups: string[][]; contactRecordIds: string[]; policyRows: PolicyRowId[] }
  | { kind: "nothing" }
)

export const EXPECTED_CASES: ExpectedCase[] = [
  {
    reference: "CD-420516", kind: "ask",
    expectation: "Site (stock control): who holds the keys, at which desk. Customer note and site reply disagree; contact CONFIRMED only from the profile. No approval.",
    roles: ["site"],
    conflictGroups: [
      ["note-x7b4b75e5977108cd", "msg-x96d66b17e32a5df4"],
      ["msg-x5d8006558b9e7cc6", "ep-xf77895617a67a311", "alert-x9dd9663e6059eeba", "work-x2174da059fcd89e8"],
    ],
    contactRecordIds: ["ep-xf77895617a67a311", "site-001"],
    policyRows: ["site-routine"],
  },
  {
    reference: "CD-420437", kind: "ask",
    expectation: "Buyer cus-025 Calverona Auto: is Celia Hollowmere authorised to sign; if not, who. Customer side: propose only.",
    roles: ["customer"],
    conflictGroups: [
      ["msg-x47456eacbe1e0e07", "msg-xf61ef17129348509"],
      ["msg-x0049fe6fc2fd0b0e"],
    ],
    contactRecordIds: [
      "conv-x0eed829e1b54984f", "conv-x927046e51b48fd87", "cus-025", "ord-00437", "ep-x61821adf903f2d7d",
      "msg-x47456eacbe1e0e07", "msg-xf61ef17129348509", "msg-x0049fe6fc2fd0b0e",
    ],
    policyRows: ["customer-side"],
  },
  {
    reference: "CD-420089", kind: "ask",
    expectation: "Operator (note author ops-shift): is the Lahti train still right, given the CD-420719 duty ends in Helsinki. No approval.",
    roles: ["operator"],
    conflictGroups: [
      ["note-x30f784d8cd92ba78", "res-xac6651462ee0355a", "asg-xa8246d35bc877646", "travel-x9f257e384701f386"],
      ["step-x88ed7ca82db890c5", "step-x13f6faa21ee54b85", "asg-xb8ad81e2d1e793a9"],
    ],
    contactRecordIds: ["note-x30f784d8cd92ba78"],
    policyRows: ["operator-question"],
  },
  {
    reference: "CD-420399", kind: "ask",
    expectation: "Driver drv-331: which trip the 137.10 EUR train claim was for. No approval.",
    roles: ["driver"],
    conflictGroups: [
      ["msg-x3bdbe64dcd0bd46e", "msg-x5721ecf683cd9920"],
      ["expense-x9d676667cdd4f893"],
    ],
    contactRecordIds: ["asg-x8cb23e805f9b3043", "msg-x3bdbe64dcd0bd46e", "expense-x9d676667cdd4f893", "conv-x8f5e0de495c9e7b8"],
    policyRows: ["driver-routine"],
  },
  {
    reference: "CD-420458", kind: "nothing",
    expectation: "Nobody yet: the customer was asked at 08:51, next check 10:00. Negative test: wait.",
  },
  {
    reference: "CD-420656", kind: "ask",
    expectation: "Site: is the car released in Friday's slot, or still waiting on a part. A slot change later needs a yes.",
    roles: ["site"],
    conflictGroups: [
      ["msg-x30a84e718591defa", "msg-x488144ab691ee379"],
      ["ep-x377904e24cf3732d", "win-x1bc8edb0f9c54604", "msg-xa89af197576aeb8f"],
    ],
    contactRecordIds: ["ep-x377904e24cf3732d", "site-065"],
    policyRows: ["site-routine"],
  },
  {
    reference: "CD-420311", kind: "ask",
    expectation: "The only travel quote leaves from Pori (home city) but the previous duty ends in Helsinki: ask where the driver starts.",
    roles: ["driver", "operator"],
    conflictGroups: [
      ["travel-xf2bdef20786d3ba8", "travel-xd67df51ec95450b8"],
      ["asg-x7fd46f1afa73cdef"],
    ],
    contactRecordIds: ["asg-x7fd46f1afa73cdef"],
    policyRows: ["driver-routine", "operator-question"],
  },
]

export type Check = { name: string; pass: boolean; detail: string }

export type CaseScore = { reference: string; points: number; max: number; checks: Check[]; status: ReviewResult["status"]; findings: number; cost: number }

function checksFor(expected: Extract<ExpectedCase, { kind: "ask" }>, finding: Finding | undefined): Check[] {
  const cited = new Set(finding?.conflict.map((item) => item.recordId) ?? [])
  const missing = expected.conflictGroups.filter((group) => !group.some((id) => cited.has(id)))
  const contactOk = !!finding && expected.roles.includes(finding.ask.role) && expected.contactRecordIds.includes(finding.ask.contactRecordId)
  return [
    { name: "records", pass: !!finding && missing.length === 0, detail: finding ? (missing.length ? `missing one of: ${missing.map((group) => group.join(" | ")).join("; ")}` : [...cited].join(", ")) : "no finding" },
    { name: "contact", pass: contactOk, detail: finding ? `${finding.ask.role} via ${finding.ask.contactRecordId}` : "no finding" },
    { name: "approval", pass: !!finding && expected.policyRows.includes(finding.policyRow), detail: finding ? finding.policyRow : "no finding" },
  ]
}

export function scoreCase(expected: ExpectedCase, result: ReviewResult): CaseScore {
  const findings = result.status === "reviewed" ? result.findings : []
  const base = { reference: expected.reference, status: result.status, findings: findings.length, cost: result.cost }
  if (expected.kind === "nothing") {
    const pass = result.status === "reviewed" && findings.length === 0
    const checks = [{ name: "no re-asking", pass, detail: result.status === "reviewed" ? `${findings.length} question(s)` : result.reason }]
    return { ...base, checks, points: pass ? 1 : 0, max: 1 }
  }
  if (result.status !== "reviewed") {
    const checks = ["records", "contact", "approval"].map((name) => ({ name, pass: false, detail: result.reason }))
    return { ...base, checks, points: 0, max: 3 }
  }
  // Score the finding that matches best; extra findings neither add nor subtract.
  let best = checksFor(expected, undefined)
  for (const finding of findings) {
    const checks = checksFor(expected, finding)
    if (checks.filter((check) => check.pass).length > best.filter((check) => check.pass).length) best = checks
  }
  return { ...base, checks: best, points: best.filter((check) => check.pass).length, max: 3 }
}

export type RunScore = { cases: CaseScore[]; points: number; max: number; cost: number }

export function scoreRun(results: ReviewResult[]): RunScore {
  const cases = EXPECTED_CASES.map((expected) => {
    const result = results.find((item) => item.reference === expected.reference)
    if (!result) throw new Error(`No result for ${expected.reference}`)
    return scoreCase(expected, result)
  })
  return {
    cases,
    points: cases.reduce((sum, item) => sum + item.points, 0),
    max: cases.reduce((sum, item) => sum + item.max, 0),
    cost: results.reduce((sum, item) => sum + item.cost, 0),
  }
}
