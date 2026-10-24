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

**Status:** resolved

- [x] Every order is in exactly one group, and the counts add up to 100
- [x] Each strong rule passes, fails or can't be evaluated, and declares its first action
- [x] 18 orders have a weak-signal site call planned at load
- [x] A delivered order with a strong gap goes to Needs action; with only a weak gap it stays Normal and lists the gap under "couldn't check"
- [x] CD-420806 is flagged for a stale-tracking check-in and is not shown as late
- [x] The queue filters read Needs action, In progress, Normal and Done; Needs action is ranked by urgency
- [x] Checked, passed and couldn't-check items show on the preview and order page, each linked to its source record
- [x] Engine tests cover each rule against real orders
- [x] The smoke check confirms each order's group matches between the queue and the order API

## Comments

- Interpretations (all in `starter/lib/engine/rules.ts`, covered by `starter/lib/engine/rules.test.ts`):
  - "Contact missing" (R5) also counts a named contact that is UNCONFIRMED for a handover still ahead. That is what makes the planned site calls at load exactly 18 (pickup not yet recorded, slot starting within 48 h or already started, pickup contact handle known, any weak signal). A contact never on record stays a gap after the handover; an old unconfirmed status does not (dataset/SCHEMA.md).
  - R1 also fires on CD-420458 and CD-421044 (intake orders without a plan whose pickup site still requires a release): 10 orders, matching the PRD's "~10".
  - R7 counts only the customer's REQUESTED_DELIVERY_SLOT on the promise's point, on orders not yet finished (5 orders, as in the PRD).
  - R13: a positioning claim (not rejected or superseded) with no `reservation_id`, on an assignment that has no travel reservation at all (CD-420291, CD-420399, CD-420537).
  - R12 compares the latest ETA with the promise end strictly. On the snapshot only CD-420439 fires; CD-420437's ETA (13:58Z) is inside its promise (ends 14:00Z).
  - Done needs a finished order with nothing open. An extra check, `CLOSE`, lists open proofs, required documents MISSING or REQUESTED, claims, alerts, work items, incidents, unsettled proposals, custody follow-ups and live assignments. Submitted proofs awaiting review count as open, so most delivered orders sit in Needs action.
  - Planned agent work (routine calls, reviewer passes) puts an order in In progress until tickets 06 and 10 carry it out.
- Source links go to the folded record section that holds the record (route, work, drivers, travel, costs, evidence, proposals) and open it; the link shows the record id. Records inside those sections have no anchors of their own.
