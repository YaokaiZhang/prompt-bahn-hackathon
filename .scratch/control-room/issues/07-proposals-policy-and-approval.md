# 07: Proposals, policy and approval

**What to build:** A finding becomes a proposal: what the agent wants to do or change, its evidence, the contact type, who pays, and the policy row that applies. A read-only Rules page shows the approval policy (contact type × action → acts alone, needs a yes, or propose only) and the rule checks. On an order, the operator can approve, edit, dismiss or give an instruction; in the queue they can approve a batch, with each row saying what approving will do. Each proposal keeps its history, and an instruction is fed into the order's next review run.

Contact lookup: the endpoint contact, then the site profile's pickup contact email. With neither, there is no call and no proposal to call.

**Blocked by:** 06 (Reviewer in the control room).

**Status:** resolved

- [x] Every proposal shows its evidence, contact type, who pays and policy row
- [x] The Rules page lists every policy row and rule, and proposals link to their row
- [x] Approve, edit, dismiss and instruct work on the order page and are recorded in the proposal's history
- [x] Batch approve shows what approving will do for each row before it runs
- [x] An instruction appears in the next review run's case file
- [x] An order whose proposals are all decided leaves Needs action
- [x] The Rules page sits in the shell navigation and follows DESIGN.md
- [x] Engine tests cover the proposal lifecycle and policy lookup

## Comments

- Batch approve was checked in the browser with the one proposal the real data puts in front of a yes (CD-420437). A mixed batch (a customer contact plus an order change) is covered by the engine tests, because change proposals only come from calls (ticket 10) and customer answers (ticket 08), through the `proposeChange` command.
- The "no contact on record, so no call and no proposal" path is built: the finding is listed under couldn't check. No order in the dataset has a third-party site without an endpoint handle or a site pickup email, so there is no engine test for it.
- Approving a change proposal records the yes. Writing the effect event belongs to ticket 09.
