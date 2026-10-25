// The evidence check on the parts of a finding people read.

import assert from "node:assert/strict"
import { test } from "node:test"
import type { CaseRecord } from "./records"
import { checkFinding, type RecordIndex } from "./validate"

const record = (id: string, kind: string, fields: Record<string, unknown>): CaseRecord => ({ id, kind, at: null, local: null, source: "test", statedBy: null, fields })

const index: RecordIndex = new Map([
  record("msg-1", "message", { body: "Pickup is at the north gate." }),
  record("msg-2", "message", { body: "Pickup is at the south gate." }),
  record("asg-1", "work_assignments", { driver_id: "drv-434" }),
].map((row) => [row.id, row]))

const finding = (question: string) => ({
  title: "Two pickup gates", question, why: "The driver needs one gate.", who_pays: "Not the payer",
  conflict: [{ record_id: "msg-1", field: "body", quote: "north gate" }, { record_id: "msg-2", field: "body", quote: "south gate" }],
  ask: { role: "driver", contact_type: "driver", contact_record_id: "asg-1", contact_quote: "drv-434", name: "the driver" },
  policy_row: "driver-routine",
})

test("a finding names people, never guesses he or she", () => {
  assert.equal(checkFinding(finding("Which gate will the driver use for CD-420001?"), { index, customerId: "cus-1" }).ok, true)
  const check = checkFinding(finding("Which gate will she use for CD-420001?"), { index, customerId: "cus-1" })
  assert.equal(check.ok, false)
  assert.match(!check.ok ? check.errors.join(" ") : "", /question: refer to people by name or role/)
})
