# 14: Tier-3 handover

**What to build:** When the voice agent can't resolve a call, it ends the call politely and hands over to an operator. The handover lands in Needs action with the transcript, a summary, the open question and a proposed next step, and an urgent push announces it.

**Blocked by:** 12 (Tier-2 voice agent), 13 (Briefing: digests and urgent pushes).

**Status:** ready-for-agent

- [ ] The voice agent ends an unresolved call politely and tells the person someone will follow up
- [ ] The handover shows the transcript, summary, open question and proposed next step on the order
- [ ] An open handover keeps the order in Needs action until the operator acts
- [ ] A handover arriving sends one urgent push
- [ ] Engine tests cover a scripted call that ends in a handover
