// The approval policy (PRD §7.1, ADR 0001): contact type × action type -> acts alone,
// needs a yes, or propose only. This table is the one source: the reviewer's prompt,
// its `get_policy` tool and the finding check read it, the engine turns findings into
// proposals with `policyFor`, and the Rules page renders it.
//
// Adding a row: give it an id, the contact types and action type it covers and a
// decision; `policyFor` must still find exactly one row for every contact type and
// action type (the engine's proposal tests check that). `renderPolicy` (the prompt)
// reads only id, contact, action and decision, so the other fields can change
// without changing the reviewer's prompt or its cached reviews.

export type ContactType =
  | "paying_customer"
  | "customer_given_contact"
  | "customer_owned_site"
  | "third_party_site"
  | "driver"
  | "operator"

export type AskRole = "site" | "driver" | "operator" | "customer"

export type PolicyRowId = "site-routine" | "driver-routine" | "operator-question" | "customer-side" | "order-change"

/** What the agent wants to do: ask someone a question, or change the order. */
export type ActionType = "question" | "change"

export type Decision = "acts alone" | "needs a yes" | "propose only"

export type PolicyRow = {
  id: PolicyRowId
  contact: string
  action: string
  decision: Decision
  /** The contact types the row covers. */
  contactTypes: ContactType[]
  actionType: ActionType
  /** What the agent does under this row, in one sentence (the Rules page). */
  agentDoes: string
}

export const CONTACT_TYPES: ContactType[] = ["paying_customer", "customer_given_contact", "customer_owned_site", "third_party_site", "driver", "operator"]
export const ASK_ROLES: AskRole[] = ["site", "driver", "operator", "customer"]

export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  paying_customer: "Paying customer",
  customer_given_contact: "Customer-given contact",
  customer_owned_site: "Customer-owned site",
  third_party_site: "Third-party site or seller",
  driver: "Driver",
  operator: "Operator",
}

export const POLICY: PolicyRow[] = [
  {
    id: "site-routine", contact: "Third-party site or seller's site (not the paying customer)", action: "Routine question or call", decision: "acts alone",
    contactTypes: ["third_party_site"], actionType: "question",
    agentDoes: "Calls the site's contact on record: the endpoint contact, then the site profile's pickup email. With neither there is no call and no proposal; the gap is listed under couldn't check.",
  },
  {
    id: "driver-routine", contact: "Driver", action: "Routine question or call", decision: "acts alone",
    contactTypes: ["driver"], actionType: "question",
    agentDoes: "Calls the assigned driver by driver ID.",
  },
  {
    id: "operator-question", contact: "Operator", action: "Clarifying question in the app", decision: "acts alone",
    contactTypes: ["operator"], actionType: "question",
    agentDoes: "Asks the operator in the app; the order waits in Needs action until the question is answered or dismissed.",
  },
  {
    id: "customer-side", contact: "Customer side: the paying customer, a contact the customer gave us (stated_by CUSTOMER_ORDER_INPUT), or a site the customer owns", action: "Any contact", decision: "propose only",
    contactTypes: ["paying_customer", "customer_given_contact", "customer_owned_site"], actionType: "question",
    agentDoes: "Never makes the contact. It drafts the script with the evidence; approving hands the contact to the operator, who records the answer.",
  },
  {
    id: "order-change", contact: "Anyone", action: "Order change from a call (new date, cost, booking, order update)", decision: "needs a yes",
    contactTypes: CONTACT_TYPES, actionType: "change",
    agentDoes: "Proposes the change; nothing is written to the order until an operator says yes.",
  },
]

export const POLICY_ROW_IDS: PolicyRowId[] = POLICY.map((row) => row.id)

const CUSTOMER_SIDE = new Set<ContactType>(["paying_customer", "customer_given_contact", "customer_owned_site"])

export function isCustomerSide(type: ContactType): boolean {
  return CUSTOMER_SIDE.has(type)
}

/** The policy row for doing `action` with a contact of this type. */
export function policyFor(type: ContactType, action: ActionType): PolicyRow {
  const row = POLICY.find((candidate) => candidate.actionType === action && candidate.contactTypes.includes(type))
  if (!row) throw new Error(`No policy row covers a ${action} with a ${type}`)
  return row
}

export function policyRow(id: PolicyRowId): PolicyRow {
  const row = POLICY.find((candidate) => candidate.id === id)
  if (!row) throw new Error(`Unknown policy row ${id}`)
  return row
}

/** The policy row that governs asking a contact of this type a question. */
export function questionPolicyFor(type: ContactType): PolicyRowId {
  return policyFor(type, "question").id
}

export function renderPolicy(): string {
  return POLICY.map((row) => `- ${row.id}: ${row.contact} | ${row.action} | ${row.decision}`).join("\n")
}
