import assert from "node:assert/strict"
import { test } from "node:test"
import { testReviewSource } from "./testing"
import { buildCaseFile, caseFileHash, renderCaseFile } from "./case-file"

const NOW = "2026-10-21T09:00:00.000Z"

async function caseFor(reference: string, input: Parameters<typeof buildCaseFile>[2] = { now: NOW }) {
  const source = await testReviewSource()
  const bundle = source.snapshot.bundles.find((b) => b.order.reference === reference)
  assert.ok(bundle, `no bundle for ${reference}`)
  return buildCaseFile(bundle, source, input)
}

test("the case file lists the order's records oldest first, each with id, time, source and stated_by", async () => {
  const file = await caseFor("CD-420516")
  assert.equal(file.reference, "CD-420516")
  assert.equal(file.now, NOW)
  const timed = file.records.filter((record) => record.at)
  const times = timed.map((record) => record.at!)
  assert.deepEqual(times, [...times].sort())
  // Untimed reference records (order, vehicle, site profile) come first.
  const firstTimed = file.records.findIndex((record) => record.at)
  assert.ok(file.records.slice(firstTimed).every((record) => record.at))

  const site = file.records.find((record) => record.id === "msg-x5d8006558b9e7cc6")
  assert.ok(site)
  assert.equal(site.kind, "message")
  assert.equal(site.at, "2026-10-21T08:24:00.000Z")
  assert.equal(site.statedBy, "site_contact:site-001")
  assert.equal(site.source, "site_call")
  assert.match(String(site.fields.body), /Reception does not have the keys/)

  const note = file.records.find((record) => record.id === "note-x7b4b75e5977108cd")
  assert.equal(note?.statedBy, "customer:cus-005")
  const endpoint = file.records.find((record) => record.id === "ep-xf77895617a67a311")
  assert.equal(endpoint?.statedBy, "SITE_CONTACT")
  assert.ok(file.records.some((record) => record.id === "site-001" && record.kind === "site_profile"))
})

test("local times are resolved in the record's zone", async () => {
  const file = await caseFor("CD-420516")
  const slot = file.records.find((record) => record.id === "win-x45839b2ace2c216d")
  assert.equal(slot?.fields.start_local, "26 Oct 09:00 EET")
  const message = file.records.find((record) => record.id === "msg-x5d8006558b9e7cc6")
  assert.equal(message?.local, "21 Oct 11:24 EEST")
  assert.equal(file.nowLocal, "21 Oct 12:00 EEST")
})

test("rule results and prior state are part of the case file and of its hash", async () => {
  const plain = await caseFor("CD-420516")
  const withRules = await caseFor("CD-420516", {
    now: NOW,
    rules: [{ rule: "R5", status: "couldnt_check", summary: "Delivery contact unconfirmed", recordIds: ["ep-xb32484dedc504e23"] }],
    prior: { instructions: [{ id: "instr-1", at: "2026-10-21T08:59:00Z", by: "operator", text: "Ask stock control, not reception." }] },
  })
  assert.equal(caseFileHash(plain), caseFileHash(await caseFor("CD-420516")))
  assert.notEqual(caseFileHash(plain), caseFileHash(withRules))
  const text = renderCaseFile(withRules)
  assert.match(text, /R5 couldnt_check: Delivery contact unconfirmed/)
  assert.match(text, /Ask stock control, not reception\./)
  // Prior items are records the reviewer can cite.
  assert.ok(withRules.records.some((record) => record.id === "instr-1" && record.kind === "operator_instruction"))
})

test("the rendered case file shows every record id", async () => {
  const file = await caseFor("CD-420437")
  const text = renderCaseFile(file)
  for (const record of file.records) assert.ok(text.includes(`[${record.id}]`), record.id)
  assert.match(text, /Customer \(pays Bahn\): cus-025 Calverona Auto/)
})
