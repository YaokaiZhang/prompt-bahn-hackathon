# 04: Demo clock, next checks and reset

**What to build:** The shell's snapshot clock becomes the demo clock. A demo-only control moves it forward 15 minutes or to the next due item. Next checks already recorded in the snapshot fire when their time comes (for example CD-420458 and CD-420015 at 10:00), and rule checks re-run after every clock move. A reset returns the clock to 09:00Z and clears our state.

**Blocked by:** 03 (Rule checks and the four groups).

**Status:** ready-for-agent

- [ ] The clock shows demo time and starts at 2026-10-21T09:00Z
- [ ] "+15 min" and "Next due item" move the clock and say what became due
- [ ] A next check that comes due plans its follow-up and the order's group updates
- [ ] Rule checks re-run after each clock move, so an order whose slot passes moves group
- [ ] Reset brings back the start state, with the snapshot unchanged
- [ ] The controls are labelled as demo-only and follow DESIGN.md
- [ ] Engine tests cover clock moves and next checks
