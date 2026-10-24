# 04: Demo clock, next checks and reset

**What to build:** The shell's snapshot clock becomes the demo clock. A demo-only control moves it forward 15 minutes or to the next due item. Next checks already recorded in the snapshot fire when their time comes (for example CD-420458 and CD-420015 at 10:00), and rule checks re-run after every clock move. A reset returns the clock to 09:00Z and clears our state.

**Blocked by:** 03 (Rule checks and the four groups).

**Status:** resolved

- [x] The clock shows demo time and starts at 2026-10-21T09:00Z
- [x] "+15 min" and "Next due item" move the clock and say what became due
- [x] A next check that comes due plans its follow-up and the order's group updates
- [x] Rule checks re-run after each clock move, so an order whose slot passes moves group
- [x] Reset brings back the start state, with the snapshot unchanged
- [x] The controls are labelled as demo-only and follow DESIGN.md
- [x] Engine tests cover clock moves and next checks

## Comments

- Reset keeps cached reviews (`cr_review_results` moved from `ENGINE_TABLES` to `CACHE_TABLES` in `lib/engine/schema.ts`). A cached review is keyed by prompt version, model and the whole case file (records, `now`, rules, prior state), so after reset a hit is exactly the review a fresh run would give, and a repeated demo take costs no model calls. Agent and approval *state* belongs in `ENGINE_TABLES`, which reset truncates.
- A due next check is the conditional rule `NEXT` (level-based: due once the clock reaches `next_check_at`). Waiting on the site (`SITE_CONFIRMATION`, `STOCK_CONTROL_REPLY`) with a callable pickup contact plans a routine site call; anything else (CD-420458's seller hold, a customer's vehicle identity, Ops' expense review) is "show to a person" until tickets 07/08 turn it into a proposal or an operator question.
- The demo controls are Operator-only (`/api/clock` sits outside `/api/phone`); Site and Driver keep the static snapshot line.
