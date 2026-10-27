# 05: Judge-based gate and the engineers' trace page

**What to build:** replace the two learned-case types (not-raised, same-contact) with one
learned case scored by a judge model (spec step 4): the gate keeps a lesson only when it
does no harm on the spec's cases (at most one check lost over the runs) and fixes more of
its learned cases than the prompt without it. Store each gate's trace with its distil run.
Add `/dev/learning`, a plain page for engineers that shows mistakes, restatements, distil
runs with their gate traces, and lessons with their events.

**Why:** the first real run (ticket 03) dropped a sound lesson because a dismissal meant
"right conflict, wrong person to ask", which the not-raised case cannot express. The
operator's correction, read by a judge, says what was wrong for any kind of mistake.

**Blocked by:** 03

**Status:** done; one real gate run on the test DB (27 Oct)

- [x] Judge call, strict parsing (`unclear` on anything else), blind to the lesson
- [x] Gate rule: no harm with a one-check tolerance, and more fixed with than without
- [x] Gate trace stored with the distil run; no scores on the operator's Lessons card
- [x] Judge eval: hand-written cases, recorded once, replayed in tests
- [x] `/dev/learning`, off in production unless `DEV_PAGES=1`
- [x] One real gate run on the test DB

## Real runs (27 Oct, test DB)

- Judge eval: 8/8 on three runs, under $0.001 each. One case (the review drops a conflict
  the correction wanted asked of someone else) came back "fixed" at first; the prompt now
  says so explicitly, and "repeats" or "unclear" are both right there (only "fixed" counts).
- Gate on the ticket 03 group, $0.15: dropped. Spec checks 38/38 -> 35/38, fixed 0/6 ->
  0/6. The trace shows why: the Munich site has no contact on record, so the reviewer
  still asks the customer with the lesson, and the judge says "repeats" every time.
- Open: one run with the lesson lost a whole spec case (CD-420656, no finding): 3 checks
  at once. The tolerance counts checks, so a lost case is more than noise allows. Watch
  whether real noise loses whole cases; if so, count the tolerance in cases.
- Still not run against a real model: a kept candidate, the Briefing item, approval.
