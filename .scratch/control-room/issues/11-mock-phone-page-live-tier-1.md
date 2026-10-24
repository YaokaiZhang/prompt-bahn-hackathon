# 11: Mock phone page, live tier 1

**What to build:** The Site and Driver personas get a phone page that rings for demo calls and calls marked "ring live". The person can answer, decline or ignore, hears the spoken prompts, and answers on a keypad. Each persona's phone takes one live call at a time and queues the rest. Background calls keep their scripted answers. CD-420516 runs live: a site call about the keys that needs no approval.

**Blocked by:** 02 (Persona login), 10 (Tier-1 calls with a simulated person).

**Status:** ready-for-agent

- [ ] The phone page rings when a live call starts and shows who is calling and about which order
- [ ] Answer, decline and ignore lead to the matching call states, including a callback
- [ ] Prompts play aloud, and keypad answers reach the call
- [ ] A second live call waits until the first ends
- [ ] The operator can mark a call "ring live"
- [ ] The CD-420516 key call runs live end to end and its result shows on the order
- [ ] The phone page works on a phone screen and follows DESIGN.md
