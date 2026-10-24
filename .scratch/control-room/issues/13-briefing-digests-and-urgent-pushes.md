# 13: Briefing: digests and urgent pushes

**What to build:** The operator gets a Briefing inbox in the shell. Digests arrive at 09:00, 12:00 and 16:00 on the demo clock. Their facts and counts come from rule checks with no LLM; Haiku (low effort) writes the prose using placeholders such as `{{count.needs_action}}` and `{{order:CD-420437}}`, any digit it types is rejected, and template text replaces the prose if it is late (about 5 s) or fails. Digests are cached by a hash of their facts. Urgent pushes are template-only and sent at once when an order becomes urgent: an action due within 2 h, a promise at risk today, or pickup within 24 h with no confirmed contact or release. At most one push per order per reason. New items show as a toast and a badge.

**Blocked by:** 04 (Demo clock, next checks and reset), 06 (Reviewer in the control room).

**Status:** ready-for-agent

- [ ] A digest arrives at each scheduled demo time, with counts that match the queue
- [ ] Order references in a digest link to the order
- [ ] Prose containing a typed digit is rejected and replaced with template text
- [ ] With no API key or a slow model, the digest still arrives with template text
- [ ] An order turning urgent sends one push for that reason and no repeats
- [ ] A toast and a badge show new items; the Briefing inbox follows DESIGN.md
- [ ] Engine tests cover digest facts and push limits
