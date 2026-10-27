# 01: Capture mistakes, with restated operator reasons

**What to build:** every operator dismissal (with a reason) and script edit of a
proposal, and every plain-words validator rejection, is stored as a mistake that
survives a demo reset. A free-text dismiss reason is restated in the background by
Haiku (no reasoning) into a neutral correction, validated by code; failures are kept but
marked unusable. Reviewer mistakes keep enough of the case file to become an eval case.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Mistakes table + store methods (memory and Postgres), kept across reset
- [ ] Dismiss with reason / edit record a mistake with tags (failing rule ids, policy row, contact type, proposal kind)
- [ ] Plain-words rejections record a mistake (reason from the validator, tag: card kind)
- [ ] Restatement: isolated call, background, never blocks the request; validation rejects instruction words, URLs, record ids, and numbers/names not in the note or records
- [ ] Offline tests with a scripted gateway
