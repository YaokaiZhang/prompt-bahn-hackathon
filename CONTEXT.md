# Car Delivery Control Room

The place where Bahn operators and agents work together to get every car delivered. Agents check orders, ask the cheap questions, and bring an operator only the decisions that need a person.

## People and parties

**Operator**:
A Bahn operations staff member who reviews agent work and makes decisions in the control room.
_Avoid_: Admin, operator manager, user

**Customer**:
The party that pays Bahn for an order (`orders.customer_id`), usually a dealer.
_Avoid_: Buyer, client, account, persona

**Customer side**:
The customer, any contact the customer gave us on the order, and any site the customer owns. The agent never contacts the customer side; it only proposes contact to an operator.

**Driver**:
The freelance driver assigned to move the car.

**Seller**:
The party responsible for releasing the car at pickup: its readiness, papers and keys.
_Avoid_: Pickup place, site (a site is a place, not a party)

**Persona**:
A demo login role (Operator, Site, Driver) that decides which screen a person sees. A persona is not a party to the order.
_Avoid_: Customer, user type

## Places

**Endpoint**:
An order's pickup or delivery point, with its address, access instructions and contact. It may be a private address with no site.
_Avoid_: Pickup place, location, stop

**Site**:
A managed place profile (dealership, source dealer, storage or transfer yard) with standard hours, rules and a contact email that an endpoint may point to.
_Avoid_: Place, branch, location

## Checking

**Rule check**:
A deterministic test over an order's records that passes, fails, or can't be evaluated.
_Avoid_: Flag, alert, validation

**Strong rule**:
A rule check whose failure puts the order in front of an agent or operator on its own.

**Couldn't-check item**:
A known gap in an order's records (for example, no pickup contact on record) that is listed openly but does not by itself make the order need action.
_Avoid_: Warning, weak flag

**Reviewer**:
The LLM agent that reads one order's records and looks for information that conflicts or is wrong.
_Avoid_: Document reviewer agent, checker

**Finding**:
One conflict the reviewer found, citing the records that disagree and the record that names who to ask.
_Avoid_: Issue, flag, conflict report

**Alert**:
A signal recorded in the dataset that is a reason to look, not a diagnosis. Not produced by the control room.
_Avoid_: Flag, finding

**Checked normal**:
An order whose rule checks passed and whose records the reviewer read without finding a conflict.
_Avoid_: Quiet, no alert, OK

## Order groups

**Needs action**:
The group of orders waiting on an operator's decision or contact.

**In progress**:
The group of orders where an agent action is running or waiting on a reply.

**Normal**:
The group of orders that are checked normal and not finished.

**Done**:
The group of orders that are finished completely: delivered or cancelled, with nothing open.
_Avoid_: Delivered (a delivered order can still have gaps)

## Agent work and decisions

**Proposal**:
Something an agent wants to do or change, with its evidence, who pays, and the policy row that applies, waiting for an operator's decision.
_Avoid_: Suggestion, recommendation, action item, task, to-do
A proposal moves through proposed, approved, answered (for customer-side contact) and dismissed. It stays one proposal throughout.

**Approve**:
An operator's yes on a proposal. On a change proposal it writes an effect event; on a customer-side proposal it hands the contact to the operator.
_Avoid_: Accept, confirm, sign off

**Policy row**:
One line of the approval policy that says, for a contact type and action type, whether the agent acts alone, needs a yes, or may only propose.

**Instruction**:
An operator's direction to the agent, saved on a proposal, explaining how to act differently.
_Avoid_: Comment, note, feedback

**Effect event**:
The record of a committed change to an order, written only after an operator's yes. Proposal text is never a fact; an effect event is.
_Avoid_: Update, change, mutation, operational event (that is the dataset's history)

**Snapshot**:
The fixed dataset as of 2026-10-21T09:00Z. Effect events are layered on top of it, and it is never edited.

**Demo clock**:
The control room's notion of "now", starting at the snapshot time and moved forward only on purpose.

## Calls

**Call**:
A mock phone contact by the agent with a site or driver, run in tiers from cheapest to most expensive.
_Avoid_: Contact (broader), phone task

**Tier**:
One level of a call: 1 is fixed keypad questions, 2 is the LLM voice agent, 3 is handover to an operator.

**Handover**:
The end of a call that the voice agent couldn't resolve, giving an operator the transcript, a summary, the open question, and a proposed next step.
_Avoid_: Escalation, transfer

**Callback**:
A later call the agent scheduled because nobody answered or the person was busy.

**Next check**:
A follow-up time already recorded in the snapshot from earlier work, such as a site call due at 10:00. It is not a callback; the agent did not schedule it.
_Avoid_: Callback, reminder

## Summaries

**Digest**:
A scheduled summary in the Briefing inbox, with counts taken from rule checks and prose written by an LLM.
_Avoid_: Report, email, summary email

**Urgent push**:
An immediate template-only notice that an order became urgent or a handover arrived.
_Avoid_: Alert, notification
