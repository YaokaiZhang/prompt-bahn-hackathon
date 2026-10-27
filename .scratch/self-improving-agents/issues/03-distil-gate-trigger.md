# 03: Distil and gate, triggered by mistake count

**What to build:** when a mistake is recorded and its group meets the thresholds, a
background run asks the distiller (Opus 5.5, medium thinking) for a lesson, validates it
in code, runs the reviewer eval with and without it (including learned cases from the
source mistakes), and stores a passing candidate for the operator. Cooldown, one run at
a time, daily spend cap. `npm run lessons` runs the same step by hand.

**Blocked by:** 01, 02

**Status:** done; one real run on the test DB (27 Oct), the gate dropped the lesson (see below)

- [x] Grouping and thresholds counted in code
- [x] Distiller call and output validation
- [x] Learned eval cases; two-run comparison; the gate
- [x] Trigger, cooldown, single flight, spend cap
- [x] Tests with a scripted gateway; one real run on the test DB

## Real run (27 Oct, test DB)

- Reviewer eval `--dry`: 19/19, $0.03.
- Group `reviewer/rule:none/contact:paying_customer`: three dismissals on two orders over
  21 and 22 Oct (demo clock); the reasons said site-held facts (who signs, who releases
  the keys, opening hours) belong to the site, not the paying customer.
- Restatement: one of three was first rejected as "too long" (the restater lands near 300
  characters despite "forty words"). Restatements now may run to 400
  (`RESTATEMENT_MAX_LENGTH`); lessons keep 300.
- Distiller `--dry`: a sound candidate that passed every check ($0.02).
- `npm run lessons`: dropped by the gate, $0.15. Existing 100% -> 97% (one check in four
  runs), learned 0% -> 0%.
- Why learned stayed at 0%: a dismissal becomes a not-raised case, but these dismissals
  meant "right conflict, wrong person to ask", so a reviewer following the lesson still
  raises the conflict and fails the check. And on CD-420437 the Munich delivery point is a
  third-party handoff with no site contact (R5 couldn't check), so the customer is the
  only one the reviewer can ask anyway. The test reasons asked for what the data can't give.
- Open: a learned case for "wrong contact" dismissals (raised again is fine when the ask
  goes elsewhere) needs a design call. The candidate, Briefing and approve path have not
  run against a real model yet.
