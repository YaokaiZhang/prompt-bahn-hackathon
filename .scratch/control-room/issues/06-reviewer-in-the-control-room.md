# 06: Reviewer in the control room

**What to build:** The three checking layers run in the app. Strong rule checks run first. Orders with records the rules can't read (open conversations, messages or notes, endpoint claims, inbox threads naming the order, open alerts, work items or incidents) go to the reviewer. A one-time sweep at seed time reviews the rest, so a quiet Normal order shows "Reviewer read N records, no conflict". Findings appear on the order page with the conflicting records highlighted and linked, and they feed the groups. Without an API key, seeding still works and orders show "not reviewed yet".

**Blocked by:** 03 (Rule checks and the four groups), 05 (Reviewer core and eval).

**Status:** ready-for-agent

- [ ] Orders with unreadable records are reviewed, and the rest are covered by the seed sweep
- [ ] A Normal order shows how many records the reviewer read and that it found no conflict
- [ ] An order with a finding moves to Needs action
- [ ] Each finding shows its cited records highlighted on the order page
- [ ] Without an API key the app runs and orders show "not reviewed yet"
- [ ] The reviewer's model cost is recorded per order
- [ ] Engine tests run the layers with the scripted gateway
