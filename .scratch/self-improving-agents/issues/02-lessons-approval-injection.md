# 02: Lessons, operator approval, and injection into prompts

**What to build:** a lessons store (candidate, approved, rejected, retired; decisions as
events with time and actor) that survives reset. The operator sees candidates in a
Lessons section on the Rules page (lesson, explanation, source mistakes with original
notes and order links, eval scores before/after) and approves, rejects or retires them.
A new candidate creates a Briefing item linking there. Approved lessons are injected
into the reviewer and plain-words prompts, only where their tags match, at most 10 per
agent, and the cache keys include a hash of the injected lessons.

**Blocked by:** None (can start immediately; source-mistake display reads 01's table once merged)

**Status:** done

- [ ] Lessons table + store methods, kept across reset
- [ ] Rules page section and API: approve / reject / retire
- [ ] Briefing item for a new candidate
- [ ] Injection with tag matching and the cap; cache keys change only when injected lessons change
- [ ] Tests with a hand-seeded candidate, no model calls
