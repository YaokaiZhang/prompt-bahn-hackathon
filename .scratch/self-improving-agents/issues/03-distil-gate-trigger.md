# 03: Distil and gate, triggered by mistake count

**What to build:** when a mistake is recorded and its group meets the thresholds, a
background run asks the distiller (Opus 5.5, medium thinking) for a lesson, validates it
in code, runs the reviewer eval with and without it (including learned cases from the
source mistakes), and stores a passing candidate for the operator. Cooldown, one run at
a time, daily spend cap. `npm run lessons` runs the same step by hand.

**Blocked by:** 01, 02

**Status:** done (real run pending: needs ANTHROPIC_API_KEY)

- [ ] Grouping and thresholds counted in code
- [ ] Distiller call and output validation
- [ ] Learned eval cases; two-run comparison; the gate
- [ ] Trigger, cooldown, single flight, spend cap
- [ ] Tests with a scripted gateway; one real run on the test DB
