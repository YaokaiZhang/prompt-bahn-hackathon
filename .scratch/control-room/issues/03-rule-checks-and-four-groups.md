# 03: Rule checks and the four groups in the queue

**What to build:** The engine runs the strong rules and the couldn't-check items over every order and puts each order into exactly one group: Needs action, In progress, Normal or Done (precedence Needs action > In progress > Done > Normal). The home queue's filters become the four groups, with Needs action ranked by urgency, while the queue-and-preview layout stays. The preview and the order page show what was checked, what passed and what couldn't be checked, each linking to the record it came from.

Strong rules and their first actions:

| Rule | First action |
|---|---|
| Signed release required, no verified release-authority document | Site call if pickup within 48 h, otherwise show to a person |
| Positioning skips another live duty | Reviewer pass |
| Promise differs from the requested slot | Reviewer pass |
| Stale tracking (>4 h, no alert) | Driver check-in call |
| Slot passed with no pickup | Show to a person |
| ETA after promise | Driver call |
| Positioning expense with no reservation | Reviewer pass |

Couldn't-check items: contact missing, contact confirmed only from the site profile, promise source not the customer. With pickup within 48 h and a known contact they plan a tier-1 site call.

Until later tickets add reviewers, proposals and calls, a rule whose first action is "show to a person" puts the order in Needs action, and planned agent work shows as planned on the order.

**Blocked by:** 01 (Engine seam, store and test runner).

**Status:** ready-for-agent

- [ ] Every order is in exactly one group, and the counts add up to 100
- [ ] Each strong rule passes, fails or can't be evaluated, and declares its first action
- [ ] 18 orders have a weak-signal site call planned at load
- [ ] A delivered order with a strong gap goes to Needs action; with only a weak gap it stays Normal and lists the gap under "couldn't check"
- [ ] CD-420806 is flagged for a stale-tracking check-in and is not shown as late
- [ ] The queue filters read Needs action, In progress, Normal and Done; Needs action is ranked by urgency
- [ ] Checked, passed and couldn't-check items show on the preview and order page, each linked to its source record
- [ ] Engine tests cover each rule against real orders
- [ ] The smoke check confirms each order's group matches between the queue and the order API
