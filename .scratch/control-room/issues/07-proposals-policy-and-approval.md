# 07: Proposals, policy and approval

**What to build:** A finding becomes a proposal: what the agent wants to do or change, its evidence, the contact type, who pays, and the policy row that applies. A read-only Rules page shows the approval policy (contact type × action → acts alone, needs a yes, or propose only) and the rule checks. On an order, the operator can approve, edit, dismiss or give an instruction; in the queue they can approve a batch, with each row saying what approving will do. Each proposal keeps its history, and an instruction is fed into the order's next review run.

Contact lookup: the endpoint contact, then the site profile's pickup contact email. With neither, there is no call and no proposal to call.

**Blocked by:** 06 (Reviewer in the control room).

**Status:** ready-for-agent

- [ ] Every proposal shows its evidence, contact type, who pays and policy row
- [ ] The Rules page lists every policy row and rule, and proposals link to their row
- [ ] Approve, edit, dismiss and instruct work on the order page and are recorded in the proposal's history
- [ ] Batch approve shows what approving will do for each row before it runs
- [ ] An instruction appears in the next review run's case file
- [ ] An order whose proposals are all decided leaves Needs action
- [ ] The Rules page sits in the shell navigation and follows DESIGN.md
- [ ] Engine tests cover the proposal lifecycle and policy lookup
