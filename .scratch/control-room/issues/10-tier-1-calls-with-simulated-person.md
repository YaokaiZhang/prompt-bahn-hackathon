# 10: Tier-1 calls with a simulated person

**What to build:** The agent makes mock tier-1 calls to sites and drivers. A call moves ringing → answered, declined or no answer; then an availability check (a callback if the person is busy), then fixed keypad questions. Prompts are spoken with `openai/gpt-4o-mini-tts` and cached. Background calls are answered by a scripted simulated person: the weak-signal site calls planned at load, and driver calls from the stale-tracking and ETA rules (CD-420806). Callbacks fire on the demo clock. Call results become proposals or effect events per the policy. The order shows the live transcript, the tier and a cost meter (model cost plus €0.01 per phone minute, compared with €0.70 per operator minute, configurable).

**Blocked by:** 04 (Demo clock, next checks and reset), 07 (Proposals, policy and approval).

**Status:** resolved

- [x] Calls follow the state machine, including declined, no answer and busy with a callback
- [x] The planned site calls and the CD-420806 check-in run in the background with scripted answers
- [x] A callback fires at its time on the demo clock
- [x] The order shows the call's transcript, tier and cost against operator cost while it runs and afterwards
- [x] An order with a running call or scheduled callback is In progress
- [x] Call results become proposals or effect events, and nothing that changes the order happens without a yes
- [x] Engine tests cover the state machine with scripted answers

## Comments

- Speech: OpenRouter's `/api/v1/audio/speech` does not serve `openai/gpt-4o-mini-tts` ("Model ... does not exist", October 2026). The default is `fish-audio/s1` (about 1 s per prompt, $15 per million characters); `hexgrad/kokoro-82m` is 25x cheaper but took about 25 s per prompt. Override with `SPEECH_MODEL`, `SPEECH_VOICE`, `SPEECH_PRICE_PER_MILLION_CHARS`. The response carries no usage, so the cost is the listed price times the characters sent.
- Call results become change proposals (needs a yes) and answer the call proposals they carried. Effect events are ticket 09: approving a call's change proposal records the yes but writes nothing to the order yet.
- 5 of the 18 weak-signal site calls planned at load go to a customer-side contact (CD-420015, 449, 1011, 1051: stated_by CUSTOMER_ORDER_INPUT; CD-420719: customer-owned site). ADR 0001 makes those propose only, so the agent does not call them; they are listed as `blockedCalls`. 13 site calls and 4 driver calls run in the background.
- Tier 2 is not built (ticket 12): an escalation ends the call as a "handover" that needs a person (Needs action).
