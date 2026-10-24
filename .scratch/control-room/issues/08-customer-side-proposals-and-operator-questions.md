# 08: Customer-side proposals and operator questions

**What to build:** Contact with the customer side is propose-only (ADR 0001). The agent drafts a proposal with a script and evidence; the operator approves it, makes the contact themselves, and records the customer's answer on the same proposal, which then becomes answered. Customer side means the paying customer, a contact the customer gave (`stated_by` customer order input), or a site the customer owns. The agent can also ask the operator a question in the app when only a person can resolve a conflict, and the operator's answer goes back to the reviewer.

**Blocked by:** 07 (Proposals, policy and approval).

**Status:** ready-for-agent

- [ ] CD-420437 gets a proposal to ask Calverona Auto who may sign, with the script and evidence, and the agent never contacts them itself
- [ ] Approving a customer-side proposal hands the contact to the operator, and recording the answer marks it answered
- [ ] Customer-side contact types are worked out from the order's records, as listed above
- [ ] CD-420089 gets an operator question about the ops-shift note and the train against the CD-420719 duty
- [ ] An unanswered operator question keeps the order in Needs action, and the answer reaches the next review run
- [ ] Engine tests cover the proposed → approved → answered path and operator questions
