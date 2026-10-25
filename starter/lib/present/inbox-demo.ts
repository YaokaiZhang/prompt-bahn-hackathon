// Demo threads for the support inbox, beside the seeded ones. They show what the inbox
// agent and the operator can do with a thread:
//
//   Pellavaro Auto, CD-420593     linked; the pickup slot passed: the agent suggests the order's steps and a reply
//   Auvelloria, CD-420904         linked; the customer waits on the proof the order still has to accept
//   Kovellin Automobilhandel      not linked (no reference, in German): the agent drafts a reply; the operator can link CD-420458
//   Tilda Birkelane (driver)      no order needed: the agent drafts an answer from a colleague's internal note
//
// They live in code, not in the dataset, so the reviewer's case files stay as seeded and
// a demo reset (which clears only our own tables) or a reseed never removes them. Ids
// start `inbox-demo-`. The orders, customers and driver are real records of the dataset.

import type { Row } from "./types"

const thread = (row: Row): Row => ({ owner: "ops-support", status: "OPEN", resolution: null, candidate_basis_message_id: null, ...row })
const message = (row: Row): Row => ({ visibility: "PUBLIC", language: "en", ...row })

export const DEMO_INBOX_THREADS: Row[] = [
  thread({
    id: "inbox-demo-pickup", category: "order_status", channel: "email", counterparty_id: "cus-015", counterparty_type: "customer",
    link_state: "CONFIRMED_SINGLE", candidate_order_ids: ["ord-00593"], linked_order_ids: ["ord-00593"],
    candidate_basis: "Exact order reference and the sender's customer account agree.", candidate_basis_message_id: "inbox-demo-pickup-m1",
    resolution: { decision: "LINK_ONE_ORDER", decided_at: "2026-10-21T08:24:00Z", evidence_message_id: "inbox-demo-pickup-m1" },
    opened_at: "2026-10-21T08:21:00Z", updated_at: "2026-10-21T08:24:00Z", waiting_on: null,
  }),
  thread({
    id: "inbox-demo-proof", category: "document_request", channel: "email", counterparty_id: "cus-005", counterparty_type: "customer",
    link_state: "CONFIRMED_SINGLE", candidate_order_ids: ["ord-00904"], linked_order_ids: ["ord-00904"],
    candidate_basis: "Exact order reference and the sender's customer account agree.", candidate_basis_message_id: "inbox-demo-proof-m1",
    resolution: { decision: "LINK_ONE_ORDER", decided_at: "2026-10-21T08:38:00Z", evidence_message_id: "inbox-demo-proof-m1" },
    opened_at: "2026-10-21T08:36:00Z", updated_at: "2026-10-21T08:38:00Z", waiting_on: null,
  }),
  thread({
    id: "inbox-demo-hamburg", category: "order_status", channel: "email", counterparty_id: "cus-030", counterparty_type: "customer",
    link_state: "PENDING_MATCH", candidate_order_ids: ["ord-00458"], linked_order_ids: [],
    candidate_basis: "The sender's account has one open order collecting at Calverona Hamburg, but the message names no order reference or plate.",
    opened_at: "2026-10-21T08:42:00Z", updated_at: "2026-10-21T08:42:00Z", waiting_on: "ORDER_REFERENCE",
  }),
  thread({
    id: "inbox-demo-ferry", category: "general_policy", channel: "app_chat", counterparty_id: "drv-016", counterparty_type: "driver",
    link_state: "NO_ORDER_REQUIRED", candidate_order_ids: [], linked_order_ids: [],
    candidate_basis: "A question about the travel booking process; no job is named and none is needed to answer it.",
    opened_at: "2026-10-21T08:47:00Z", updated_at: "2026-10-21T08:52:00Z", waiting_on: null,
  }),
]

export const DEMO_INBOX_MESSAGES: Row[] = [
  message({
    id: "inbox-demo-pickup-m1", thread_id: "inbox-demo-pickup", author_id: "cus-015", author_type: "customer", recipient_id: "ops-support", recipient_type: "operator",
    channel: "email", authored_at: "2026-10-21T08:21:00Z",
    body: "Good morning. Our BMW M4 (CD-420593) was due to be collected from our Helsinki site this morning and nobody has come. The buyer in Turku is expecting the car. Can you tell us what is happening and when it will be picked up?",
  }),
  message({
    id: "inbox-demo-proof-m1", thread_id: "inbox-demo-proof", author_id: "cus-005", author_type: "customer", recipient_id: "ops-support", recipient_type: "operator",
    channel: "email", authored_at: "2026-10-21T08:36:00Z",
    body: "Hello, the Audi RS 6 on CD-420904 arrived in Vantaa last week and our receiving team signed for it. Our finance team cannot close the invoice until the job is closed on your side. Can you confirm the proof of delivery has been accepted?",
  }),
  message({
    id: "inbox-demo-hamburg-m1", thread_id: "inbox-demo-hamburg", author_id: "cus-030", author_type: "customer", recipient_id: "ops-support", recipient_type: "operator",
    channel: "email", authored_at: "2026-10-21T08:42:00Z", language: "de",
    body: "Guten Tag, unser Ferrari soll bei Calverona in Hamburg abgeholt werden. Calverona sagt, ihnen liege keine unterschriebene Freigabe vor. Was brauchen Sie von uns, damit die Abholung klappt?",
  }),
  message({
    id: "inbox-demo-ferry-m1", thread_id: "inbox-demo-ferry", author_id: "drv-016", author_type: "driver", recipient_id: "ops-support", recipient_type: "operator",
    channel: "app_chat", authored_at: "2026-10-21T08:47:00Z",
    body: "Hi! I'm doing my first job with a ferry crossing soon. Do I book the ferry ticket myself and claim it afterwards, or does the office book it?",
  }),
  message({
    id: "inbox-demo-ferry-m2", thread_id: "inbox-demo-ferry", author_id: "ops-support", author_type: "operator", recipient_id: "ops-support", recipient_type: "operator",
    channel: "internal_note", authored_at: "2026-10-21T08:52:00Z", visibility: "INTERNAL",
    body: "Travel policy: ferry and train tickets are booked by the office before the job, and the reservation is sent to the driver in the app. A ticket the driver bought themselves is not reimbursed without a reservation from us. Local transport (bus, tram, taxi when agreed) is claimed with receipts.",
  }),
]
