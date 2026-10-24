// The evidence check: a finding is accepted only if every record it cites exists and
// every quote is really in that record, and if its contact type, role and policy row
// agree with each other and with the contact record (ADR 0001: a customer-given
// contact or customer-owned site is never classed as a third party).

import type { Row } from "@/lib/present/types"
import {
  ASK_ROLES, CONTACT_TYPES, POLICY_ROW_IDS, questionPolicyFor, type AskRole, type ContactType, type PolicyRowId,
} from "./policy"
import type { CaseRecord } from "./records"

export type QuotedValue = { recordId: string; field: string; quote: string }

export type Finding = {
  title: string
  conflict: QuotedValue[]
  ask: { role: AskRole; contactType: ContactType; contactRecordId: string; contactQuote: string; name: string }
  whoPays: string
  policyRow: PolicyRowId
  question: string
  why: string
  /** True when the finding passed only after its repair attempt. */
  repaired: boolean
}

export type RecordIndex = Map<string, CaseRecord>

export type CheckContext = { index: RecordIndex; customerId: string }

export type Check = { ok: true; finding: Finding } | { ok: false; errors: string[] }

const ROLE_TYPES: Record<AskRole, ContactType[]> = {
  site: ["third_party_site", "customer_owned_site"],
  driver: ["driver"],
  operator: ["operator"],
  customer: ["paying_customer", "customer_given_contact"],
}

export function normaliseText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function leaves(value: unknown, out: string[] = []): string[] {
  if (value === null || value === undefined) return out
  if (Array.isArray(value)) for (const item of value) leaves(item, out)
  else if (typeof value === "object") for (const item of Object.values(value as Row)) leaves(item, out)
  else out.push(String(value))
  return out
}

function fieldValue(record: CaseRecord, field: string): unknown {
  let value: unknown = record.fields
  for (const part of field.split(".")) {
    if (!value || typeof value !== "object") return undefined
    value = (value as Row)[part]
  }
  return value
}

/**
 * A quote copied from the case file's JSON as `"key":"value"` (or `"key":123`): the value,
 * provided the key is the named field or its last part (or no field is named).
 */
function keyValueQuote(field: string, quote: string): string | null {
  const match = /^\s*"([^"]+)"\s*:\s*(.+?)\s*,?\s*$/.exec(quote)
  if (!match) return null
  const [, key, rest] = match
  if (field && key !== field && key !== field.split(".").at(-1)) return null
  try {
    const value = JSON.parse(rest) as unknown
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null
  } catch {
    return null
  }
}

/** Is `quote` in the record? In the named field when it exists, else anywhere in the record. */
export function quoteMatches(record: CaseRecord, field: string, quote: string): boolean {
  const pair = keyValueQuote(field, quote)
  if (pair !== null) return quoteMatches(record, field, pair)
  const wanted = normaliseText(quote).replace(/^["']|["']$/g, "").replace(/[.]$/, "")
  if (!wanted) return false
  const named = field ? fieldValue(record, field) : undefined
  const haystack = named !== undefined ? leaves(named) : [...leaves(record.fields), record.statedBy ?? "", record.id]
  return haystack.some((value) => normaliseText(value).includes(wanted))
}

/** For repair feedback: the named field's actual value, when it is short enough to show. */
function valueHint(record: CaseRecord, field: string): string {
  const value = field ? fieldValue(record, field) : undefined
  if (value === undefined) return field ? ` (${record.id} has no field ${field})` : ""
  const shown = typeof value === "string" ? value : JSON.stringify(value)
  return shown.length <= 200 ? ` (its value is ${JSON.stringify(shown)})` : ""
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

/** The contact type the records force, if any. */
function forcedType(record: CaseRecord, ctx: CheckContext): ContactType | null {
  if (record.kind === "order_endpoint_details") {
    if (record.statedBy === "CUSTOMER_ORDER_INPUT") return "customer_given_contact"
    const siteId = text(record.fields.site_id)
    const site = siteId ? ctx.index.get(siteId) : undefined
    if (site && site.fields.customer_id === ctx.customerId) return "customer_owned_site"
  }
  if (record.kind === "site_profile" && record.fields.customer_id === ctx.customerId) return "customer_owned_site"
  if (record.kind === "customer" && record.id === ctx.customerId) return "paying_customer"
  return null
}

/** Checks one raw finding from submit_findings. Errors are written for the model to repair. */
export function checkFinding(raw: unknown, ctx: CheckContext): Check {
  const errors: string[] = []
  const input = raw && typeof raw === "object" ? (raw as Row) : {}
  const title = text(input.title)
  const question = text(input.question)
  const why = text(input.why)
  const whoPays = text(input.who_pays)
  if (!title) errors.push("title is missing")
  if (!question) errors.push("question is missing")
  if (!why) errors.push("why is missing")
  if (!whoPays) errors.push("who_pays is missing")

  const conflict: QuotedValue[] = []
  const items = Array.isArray(input.conflict) ? input.conflict : []
  if (items.length < 2) errors.push("conflict must cite at least two records that disagree")
  items.forEach((item, i) => {
    const row = item && typeof item === "object" ? (item as Row) : {}
    const recordId = text(row.record_id)
    const field = text(row.field) ?? ""
    const quote = text(row.quote)
    if (!recordId || !quote) { errors.push(`conflict[${i}] needs record_id and quote`); return }
    const record = ctx.index.get(recordId)
    if (!record) { errors.push(`conflict[${i}]: record ${recordId} does not exist`); return }
    if (!quoteMatches(record, field, quote)) { errors.push(`conflict[${i}]: "${quote}" is not in ${recordId}${field ? `.${field}` : ""}${valueHint(record, field)}`); return }
    conflict.push({ recordId, field, quote })
  })

  const ask = input.ask && typeof input.ask === "object" ? (input.ask as Row) : {}
  const role = oneOf(ask.role, ASK_ROLES)
  const contactType = oneOf(ask.contact_type, CONTACT_TYPES)
  const contactRecordId = text(ask.contact_record_id)
  const contactQuote = text(ask.contact_quote)
  const name = text(ask.name) ?? contactQuote ?? ""
  if (!role) errors.push(`ask.role must be one of ${ASK_ROLES.join(", ")}`)
  if (!contactType) errors.push(`ask.contact_type must be one of ${CONTACT_TYPES.join(", ")}`)
  if (!contactRecordId || !contactQuote) errors.push("ask needs contact_record_id and contact_quote")
  else {
    const record = ctx.index.get(contactRecordId)
    if (!record) errors.push(`ask: contact record ${contactRecordId} does not exist`)
    else {
      if (!quoteMatches(record, "", contactQuote)) errors.push(`ask: "${contactQuote}" is not in ${contactRecordId}`)
      const forced = forcedType(record, ctx)
      if (forced && contactType && forced !== contactType) errors.push(`ask: the contact in ${contactRecordId} is ${forced}, not ${contactType}`)
    }
  }
  if (role && contactType && !ROLE_TYPES[role].includes(contactType)) errors.push(`ask: role ${role} does not fit contact type ${contactType}`)

  const policyRow = oneOf(input.policy_row, POLICY_ROW_IDS)
  if (!policyRow) errors.push(`policy_row must be one of ${POLICY_ROW_IDS.join(", ")}`)
  else if (contactType && policyRow !== questionPolicyFor(contactType)) {
    errors.push(`policy_row: asking a ${contactType} falls under ${questionPolicyFor(contactType)}, not ${policyRow}`)
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    finding: {
      title: title!, conflict,
      ask: { role: role!, contactType: contactType!, contactRecordId: contactRecordId!, contactQuote: contactQuote!, name },
      whoPays: whoPays!, policyRow: policyRow!, question: question!, why: why!, repaired: false,
    },
  }
}
