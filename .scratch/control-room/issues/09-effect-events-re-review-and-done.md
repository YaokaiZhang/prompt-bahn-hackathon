# 09: Effect events, the re-review loop and Done

**What to build:** Approving a change proposal writes an append-only effect event; recording a customer's or operator's answer writes one too. The order view, rule checks and reviewer all read the snapshot with effect events applied (ADR 0002). An effect event that creates a new conflict sends the order back to review. Done follows its rules: delivered or cancelled with nothing open. Journey 1 (CD-420437) runs end to end.

Effect event types: contact confirmed, contact changed, window changed, call result recorded, customer answer recorded, operator answer recorded, cost approved.

**Blocked by:** 08 (Customer-side proposals and operator questions).

**Status:** resolved

- [x] Each of the seven types changes what the order view shows and is listed in the order's history with who approved it
- [x] The snapshot rows are never changed
- [x] Rules and the reviewer see the snapshot with effect events applied
- [x] Recording an answer that creates a new conflict re-runs the reviewer and shows the new finding
- [x] Orders move into Done only when finished and nothing is open
- [x] Journey 1 runs from finding to recorded answer to Normal, and the variant with a new conflict lands back in Needs action
- [x] Engine tests cover the overlay and the re-review loop

## Comments

- Effect events are versioned (user decision): each writes version n+1 of the fact it settles (`fact`, `version`), names the records it
  replaces (`supersedes`: only the answering party's own earlier statements on that question), and the overlay marks those records
  "SUPERSEDED by <event>" while keeping them citable. No reviewer prompt change was needed: with the real model, journey 1 reached
  Normal (script and Playwright run) and the "Marten Calver leaves at 14:30" variant landed back in Needs action with a finding citing
  the effect event and the 15:58 ETA. PROMPT_VERSION unchanged; replay eval still 19/19.
- A customer's answer becomes a committed effect event when the operator approves the order update the agent proposes from it (the
  governed change of story 66); the operator's own answer to a question is committed at once; a finished call with claims is committed
  at once by the agent (recordCallResult).
