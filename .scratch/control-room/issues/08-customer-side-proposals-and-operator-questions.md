# 08: Customer-side proposals and operator questions

**What to build:** Contact with the customer side is propose-only (ADR 0001). The agent drafts a proposal with a script and evidence; the operator approves it, makes the contact themselves, and records the customer's answer on the same proposal, which then becomes answered. Customer side means the paying customer, a contact the customer gave (`stated_by` customer order input), or a site the customer owns. The agent can also ask the operator a question in the app when only a person can resolve a conflict, and the operator's answer goes back to the reviewer.

**Blocked by:** 07 (Proposals, policy and approval).

**Status:** resolved

- [x] CD-420437 gets a proposal to ask Calverona Auto who may sign, with the script and evidence, and the agent never contacts them itself
- [x] Approving a customer-side proposal hands the contact to the operator, and recording the answer marks it answered
- [x] Customer-side contact types are worked out from the order's records, as listed above
- [x] CD-420089 gets an operator question about the ops-shift note and the train against the CD-420719 duty
- [x] An unanswered operator question keeps the order in Needs action, and the answer reaches the next review run
- [x] Engine tests cover the proposed → approved → answered path and operator questions

## Comments
- Contact types from records live in `starter/lib/engine/contacts.ts` and also gate the rules' planned site calls. Weak-signal site calls at load drop from 18 to 14: CD-420719 picks up at its customer's own site, and CD-420449/1011/1051's pickup contact is a person the customer gave (ADR 0001 wins over the spec's "18"). One refinement: an endpoint stated by CUSTOMER_ORDER_INPUT whose handle is a third-party site's own desk email (CD-420015's site-005, CD-420023's site-038) counts as that site, so CD-420015 keeps its routine call (PRD J2). The reviewer's finding check (`validate.ts`, not changed) has no such exception and is stricter.
- Real model on CD-420437 and CD-420089 only: 437 got two customer-side proposals (who may sign; until when); 089 got the operator question citing the ops-shift note, the Lahti train and the CD-420719 step. After recording "Celia Hollowmere may sign; she is there until 18:00", the re-review of 437 raised a new conflict between the recorded answer and the 10:42 message "I still cannot confirm who is authorized". Telling the reviewer that a newer recorded answer settles an older message is prompt work (left to 09 / reviewer tuning).
- The NEXT rule's show_person on CD-420458/009/326 (spec story 69) is still a rule decision, not a proposal. None of this ticket's checkboxes covers it.
