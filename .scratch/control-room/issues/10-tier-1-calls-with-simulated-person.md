# 10: Tier-1 calls with a simulated person

**What to build:** The agent makes mock tier-1 calls to sites and drivers. A call moves ringing → answered, declined or no answer; then an availability check (a callback if the person is busy), then fixed keypad questions. Prompts are spoken with `openai/gpt-4o-mini-tts` and cached. Background calls are answered by a scripted simulated person: the weak-signal site calls planned at load, and driver calls from the stale-tracking and ETA rules (CD-420806). Callbacks fire on the demo clock. Call results become proposals or effect events per the policy. The order shows the live transcript, the tier and a cost meter (model cost plus €0.01 per phone minute, compared with €0.70 per operator minute, configurable).

**Blocked by:** 04 (Demo clock, next checks and reset), 07 (Proposals, policy and approval).

**Status:** ready-for-agent

- [ ] Calls follow the state machine, including declined, no answer and busy with a callback
- [ ] The planned site calls and the CD-420806 check-in run in the background with scripted answers
- [ ] A callback fires at its time on the demo clock
- [ ] The order shows the call's transcript, tier and cost against operator cost while it runs and afterwards
- [ ] An order with a running call or scheduled callback is In progress
- [ ] Call results become proposals or effect events, and nothing that changes the order happens without a yes
- [ ] Engine tests cover the state machine with scripted answers
