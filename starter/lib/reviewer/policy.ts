// The approval policy as the reviewer cites it (PRD §7.1, ADR 0001). Ticket 07 owns
// the policy config and the Rules page; until then the reviewer's prompt, its
// `get_policy` tool and the finding check read this table.

export type ContactType =
  | "paying_customer"
  | "customer_given_contact"
  | "customer_owned_site"
  | "third_party_site"
  | "driver"
  | "operator"

export type AskRole = "site" | "driver" | "operator" | "customer"

export type PolicyRowId = "site-routine" | "driver-routine" | "operator-question" | "customer-side" | "order-change"

export type PolicyRow = {
  id: PolicyRowId
  contact: string
  action: string
  decision: "acts alone" | "needs a yes" | "propose only"
}

export const POLICY: PolicyRow[] = [
  { id: "site-routine", contact: "Third-party site or seller's site (not the paying customer)", action: "Routine question or call", decision: "acts alone" },
  { id: "driver-routine", contact: "Driver", action: "Routine question or call", decision: "acts alone" },
  { id: "operator-question", contact: "Operator", action: "Clarifying question in the app", decision: "acts alone" },
  { id: "customer-side", contact: "Customer side: the paying customer, a contact the customer gave us (stated_by CUSTOMER_ORDER_INPUT), or a site the customer owns", action: "Any contact", decision: "propose only" },
  { id: "order-change", contact: "Anyone", action: "Order change from a call (new date, cost, booking, order update)", decision: "needs a yes" },
]

export const CONTACT_TYPES: ContactType[] = ["paying_customer", "customer_given_contact", "customer_owned_site", "third_party_site", "driver", "operator"]
export const ASK_ROLES: AskRole[] = ["site", "driver", "operator", "customer"]
export const POLICY_ROW_IDS: PolicyRowId[] = POLICY.map((row) => row.id)

const CUSTOMER_SIDE = new Set<ContactType>(["paying_customer", "customer_given_contact", "customer_owned_site"])

export function isCustomerSide(type: ContactType): boolean {
  return CUSTOMER_SIDE.has(type)
}

/** The policy row that governs asking a contact of this type a question. */
export function questionPolicyFor(type: ContactType): PolicyRowId {
  if (isCustomerSide(type)) return "customer-side"
  if (type === "driver") return "driver-routine"
  if (type === "operator") return "operator-question"
  return "site-routine"
}

export function renderPolicy(): string {
  return POLICY.map((row) => `- ${row.id}: ${row.contact} | ${row.action} | ${row.decision}`).join("\n")
}
