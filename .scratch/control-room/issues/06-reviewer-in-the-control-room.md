# 06: Reviewer in the control room

**What to build:** The three checking layers run in the app. Strong rule checks run first. Orders with records the rules can't read (open conversations, messages or notes, endpoint claims, inbox threads naming the order, open alerts, work items or incidents) go to the reviewer. A one-time sweep at seed time reviews the rest, so a quiet Normal order shows "Reviewer read N records, no conflict". Findings appear on the order page with the conflicting records highlighted and linked, and they feed the groups. Without an API key, seeding still works and orders show "not reviewed yet".

**Blocked by:** 03 (Rule checks and the four groups), 05 (Reviewer core and eval).

**Status:** resolved

- [x] Orders with unreadable records are reviewed, and the rest are covered by the seed sweep
- [x] A Normal order shows how many records the reviewer read and that it found no conflict
- [x] An order with a finding moves to Needs action
- [x] Each finding shows its cited records highlighted on the order page
- [x] Without an API key the app runs and orders show "not reviewed yet"
- [x] The reviewer's model cost is recorded per order
- [x] Engine tests run the layers with the scripted gateway

## Comments

- The full seed sweep over all 100 orders has not been run against the real model yet (the orchestrator capped it). Run `npm run review:sweep` (or `npm run db:seed -- --review`; the seed sweep is opt-in since the final review fixes) to do it. A capped real run on 3 orders worked through the proxy, at about $0.002 to $0.005 per order.
- Reasons a review failed ("model call failed", "skipped after 3 failures") live only in the engine's memory for that process. A fresh process shows such orders as a plain "not reviewed yet".
