# 14: Tier-3 handover

**What to build:** When the voice agent can't resolve a call, it ends the call politely and hands over to an operator. The handover lands in Needs action with the transcript, a summary, the open question and a proposed next step, and an urgent push announces it.

**Blocked by:** 12 (Tier-2 voice agent), 13 (Briefing: digests and urgent pushes).

**Status:** resolved

- [x] The voice agent ends an unresolved call politely and tells the person someone will follow up
- [x] The handover shows the transcript, summary, open question and proposed next step on the order
- [x] An open handover keeps the order in Needs action until the operator acts
- [x] A handover arriving sends one urgent push
- [x] Engine tests cover a scripted call that ends in a handover

## Comments

All criteria met. Choices made while building it:
- A keypad escalation that nobody can talk through (no voice agent, or a simulated callee without a model to talk; with one, ticket 12's simulated tier 2 talks it through first) is a tier-3 handover too, with the escalation as the open question and "call back" as the next step; a handed-over call shows tier 3.
- The operator acts with `recordHandoverResult { callId, result }` (order page: "Record what you learned"). It commits `call_result_recorded` by the operator (source = the call), the next version of the point the call settled, naming the agent's record of the call it supersedes, and closes the handover.
- An open handover holds its line: the agent does not call that line again until the operator has acted.
- The push follows spec story 79 (at most once per order per reason): a second handover on the same order shows in Needs action without a second push.
