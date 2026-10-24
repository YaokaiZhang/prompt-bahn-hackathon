# 09: Effect events, the re-review loop and Done

**What to build:** Approving a change proposal writes an append-only effect event; recording a customer's or operator's answer writes one too. The order view, rule checks and reviewer all read the snapshot with effect events applied (ADR 0002). An effect event that creates a new conflict sends the order back to review. Done follows its rules: delivered or cancelled with nothing open. Journey 1 (CD-420437) runs end to end.

Effect event types: contact confirmed, contact changed, window changed, call result recorded, customer answer recorded, operator answer recorded, cost approved.

**Blocked by:** 08 (Customer-side proposals and operator questions).

**Status:** ready-for-agent

- [ ] Each of the seven types changes what the order view shows and is listed in the order's history with who approved it
- [ ] The snapshot rows are never changed
- [ ] Rules and the reviewer see the snapshot with effect events applied
- [ ] Recording an answer that creates a new conflict re-runs the reviewer and shows the new finding
- [ ] Orders move into Done only when finished and nothing is open
- [ ] Journey 1 runs from finding to recorded answer to Normal, and the variant with a new conflict lands back in Needs action
- [ ] Engine tests cover the overlay and the re-review loop
