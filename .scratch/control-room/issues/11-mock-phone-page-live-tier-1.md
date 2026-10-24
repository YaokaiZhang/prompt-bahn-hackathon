# 11: Mock phone page, live tier 1

**What to build:** The Site and Driver personas get a phone page that rings for demo calls and calls marked "ring live". The person can answer, decline or ignore, hears the spoken prompts, and answers on a keypad. Each persona's phone takes one live call at a time and queues the rest. Background calls keep their scripted answers. CD-420516 runs live: a site call about the keys that needs no approval.

**Blocked by:** 02 (Persona login), 10 (Tier-1 calls with a simulated person).

**Status:** resolved

- [x] The phone page rings when a live call starts and shows who is calling and about which order
- [x] Answer, decline and ignore lead to the matching call states, including a callback
- [x] Prompts play aloud, and keypad answers reach the call
- [x] A second live call waits until the first ends
- [x] The operator can mark a call "ring live"
- [x] The CD-420516 key call runs live end to end and its result shows on the order
- [x] The phone page works on a phone screen and follows DESIGN.md
