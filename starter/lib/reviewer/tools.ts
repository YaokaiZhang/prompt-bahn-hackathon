// The reviewer's tools: read-only lookups outside the order, and submit_findings.
// Lookups return records in the case-file shape, so the reviewer can cite them.

import type { Bundle } from "@/lib/present/bundle"
import { orderZone } from "./case-file"
import { ASK_ROLES, CONTACT_TYPES, POLICY_ROW_IDS, renderPolicy } from "./policy"
import { renderRecord, sortRecords, toCaseRecord, type CaseRecord } from "./records"
import { findBundle, type ReviewSource } from "./source"
import type { ToolSpec } from "./gateway"

export const SUBMIT_FINDINGS = "submit_findings"

const quoted = {
  type: "object",
  properties: {
    record_id: { type: "string", description: "Id of a record in the case file or a tool result." },
    field: { type: "string", description: "Field the quote comes from, e.g. body or positioning.planned_release_city." },
    quote: { type: "string", description: "Exact text copied from that field's value." },
  },
  required: ["record_id", "field", "quote"],
}

export const SUBMIT_SPEC: ToolSpec = {
  type: "function",
  function: {
    name: SUBMIT_FINDINGS,
    description: "Submit the review of this order. An empty findings list means nothing to ask.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One sentence on what you read and concluded." },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "The conflict in one line." },
              conflict: { type: "array", minItems: 2, items: quoted, description: "The records that disagree, with quoted values." },
              ask: {
                type: "object",
                properties: {
                  role: { type: "string", enum: ASK_ROLES },
                  contact_type: { type: "string", enum: CONTACT_TYPES },
                  contact_record_id: { type: "string", description: "The record that names the contact." },
                  contact_quote: { type: "string", description: "The name, handle or id, copied from that record." },
                  name: { type: "string", description: "Who to ask, in words." },
                },
                required: ["role", "contact_type", "contact_record_id", "contact_quote", "name"],
              },
              who_pays: { type: "string" },
              policy_row: { type: "string", enum: POLICY_ROW_IDS },
              question: { type: "string", description: "The draft question to ask." },
              why: { type: "string" },
            },
            required: ["title", "conflict", "ask", "who_pays", "policy_row", "question", "why"],
          },
        },
      },
      required: ["summary", "findings"],
    },
  },
}

function spec(name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolSpec {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } }
}

export const READ_TOOL_SPECS: ToolSpec[] = [
  spec("get_driver_duties", "The driver's assignments on every order, with their steps and positioning.", { driver_id: { type: "string" } }, ["driver_id"]),
  spec("get_related_orders", "Another order's route, windows, endpoint contacts and assignments.", { order: { type: "string", description: "Order id (ord-00719) or reference (CD-420719)." } }, ["order"]),
  spec("get_site_profile", "A managed site's profile: hours, access notes, release rule, contact email.", { site_id: { type: "string" } }, ["site_id"]),
  spec("get_inbox_threads", "Support inbox threads naming this order (candidate or linked), with their messages."),
  spec("get_policy", "The approval policy table."),
]

export const READ_TOOLS = new Set(READ_TOOL_SPECS.map((tool) => tool.function.name))

export type ToolOutput = { content: string; records: CaseRecord[] }


function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function render(title: string, records: CaseRecord[]): ToolOutput {
  const sorted = sortRecords(records)
  const body = sorted.length ? sorted.map(renderRecord).join("\n") : "(no records)"
  return { content: `${title}\n${body}`, records: sorted }
}

function withReference(bundle: Bundle, record: CaseRecord): CaseRecord {
  return { ...record, fields: { order_reference: bundle.order.reference, ...record.fields } }
}

function driverDuties(source: ReviewSource, driverId: string): ToolOutput {
  const records: CaseRecord[] = []
  for (const bundle of source.snapshot.bundles) {
    const assignments = (bundle.related.work_assignments ?? []).filter((row) => row.details.driver_id === driverId)
    for (const assignment of assignments) {
      records.push(withReference(bundle, toCaseRecord({ id: assignment.id, kind: "work_assignments", details: assignment.details, zone: orderZone(bundle) })))
      for (const step of bundle.related.assignment_steps ?? []) {
        if (step.details.assignment_id === assignment.id) records.push(withReference(bundle, toCaseRecord({ id: step.id, kind: "assignment_steps", details: step.details, zone: orderZone(bundle) })))
      }
    }
  }
  return render(`Duties of driver ${driverId}:`, records)
}

const RELATED_COLLECTIONS = ["time_windows", "order_endpoint_details", "work_assignments", "assignment_steps", "transport_points", "documents", "work_items"]

function relatedOrder(source: ReviewSource, key: string): ToolOutput {
  const bundle = findBundle(source, key)
  if (!bundle) return { content: `No order ${key}.`, records: [] }
  const records: CaseRecord[] = [toCaseRecord({ id: bundle.order.id, kind: "order", details: bundle.order.details, zone: orderZone(bundle) })]
  for (const collection of RELATED_COLLECTIONS) {
    for (const row of bundle.related[collection] ?? []) records.push(withReference(bundle, toCaseRecord({ id: row.id, kind: collection, details: row.details, zone: orderZone(bundle) })))
  }
  for (const alert of bundle.alerts) if (alert.status !== "RESOLVED") records.push(withReference(bundle, toCaseRecord({ id: alert.id, kind: "alert", details: alert.details, zone: orderZone(bundle) })))
  return render(`Order ${bundle.order.reference} (${bundle.order.id}):`, records)
}

function siteProfile(bundle: Bundle, siteId: string): ToolOutput {
  const site = bundle.sites.get(siteId)
  if (!site) return { content: `No site ${siteId}.`, records: [] }
  return render(`Site ${siteId}:`, [toCaseRecord({ id: site.id, kind: "site_profile", details: site.details, zone: null, at: null, source: "site_profile", statedBy: null })])
}

function inboxThreads(source: ReviewSource, bundle: Bundle): ToolOutput {
  const records: CaseRecord[] = []
  for (const thread of bundle.inboxThreads) {
    records.push(toCaseRecord({ id: thread.id, kind: "inbox_thread", details: thread.details, zone: null, source: "support_inbox", statedBy: null }))
    for (const message of source.inboxMessages) {
      if (message.details.thread_id === thread.id) records.push(toCaseRecord({ id: message.id, kind: "support_inbox_messages", details: message.details, zone: null }))
    }
  }
  return render(`Inbox threads naming ${bundle.order.reference}:`, records)
}

/** Runs one read-only tool. Bad arguments come back as text for the model, not as errors. */
export function runReadTool(name: string, args: Record<string, unknown>, source: ReviewSource, bundle: Bundle): ToolOutput {
  switch (name) {
    case "get_driver_duties": {
      const id = str(args.driver_id)
      return id ? driverDuties(source, id) : { content: "driver_id is required.", records: [] }
    }
    case "get_related_orders": {
      const key = str(args.order)
      return key ? relatedOrder(source, key) : { content: "order is required.", records: [] }
    }
    case "get_site_profile": {
      const id = str(args.site_id)
      return id ? siteProfile(bundle, id) : { content: "site_id is required.", records: [] }
    }
    case "get_inbox_threads":
      return inboxThreads(source, bundle)
    case "get_policy":
      return { content: `Approval policy:\n${renderPolicy()}`, records: [] }
    default:
      return { content: `Unknown tool ${name}.`, records: [] }
  }
}
