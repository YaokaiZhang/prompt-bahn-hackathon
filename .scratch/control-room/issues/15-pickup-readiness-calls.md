# 15: Pickup-readiness calls to customer-side pickup places

**What to build:** The agent's tier-1 pickup-readiness call (is the car ready, are the papers and keys there, who hands it over, callback if nobody answers) also goes to the order's pickup place or pickup contact when that is customer side: a site the customer owns (CD-420719) or a pickup contact the customer gave us (CD-420449, CD-421011, CD-421051). Ticket 08 had made every customer-side contact propose only, which dropped these calls from the 18 planned site calls. Everything else stays propose only (ADR 0001), and the paying customer is never called.

**Blocked by:** 08 (Customer-side proposals and operator questions), 10 (Tier-1 calls with a simulated person).

**Status:** resolved

- [x] ADR 0001 has a dated amendment (2026-10-24) allowing pickup-readiness calls to a customer-owned pickup site or a customer-given pickup contact; the glossary, spec (approval paragraph, story 43, contact-type table, out of scope) and PRD say the same
- [x] The approval policy has a `pickup-readiness` row (acts alone) for those two contact types; the reviewer's prompt, policy enum, cache keys and the 19/19 replay are unchanged
- [x] The rules plan the site call again for CD-420719, CD-420449, CD-421011 and CD-421051: 18 weak-signal site calls at load
- [x] The call layer's own guard calls a customer-side callee only on a pickup endpoint with pickup-readiness topics (R1, R4, R5, R6, NEXT); any other topic is a blocked call (propose only)
- [x] A reviewer finding addressed to a customer-side contact stays a `customer_contact` proposal, never a call
- [x] The paying customer is never called (engine test and smoke check)
- [x] The Rules page lists the pickup-readiness row

## Comments

All criteria met. Built on branch `t15-pickup-readiness-calls` (commit 7ed2219) and merged into `control-room` (a20da16; merged on into the ticket 09 branch as 6cb19d5) before this file was written; this file records it after the fact.
- Choice: reviewer findings addressed to a customer-side contact stay propose only, even pickup-readiness ones; only the rules' planned site call reaches a customer-side pickup place. CD-420719 can therefore have both a `customer_contact` proposal and a background site call.
- Final review fix: R6's call topic ("delivery promise not set by the customer") is titled "Car ready in the booked pickup slot", matching the question the call asks. It stays a pickup-readiness rule, which keeps the 18 planned site calls; the delivery promise itself is never discussed on a call or superseded by one.
