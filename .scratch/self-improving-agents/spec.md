# Self-improving agents: learning from operator corrections

Status: ready-for-agent

## Problem

The agents (reviewer, plain-words, later the inbox agent) repeat the same mistakes. The
operator corrects them one order at a time (dismiss, edit, instruct) and that correction
is lost for every other order. Validator rejections are thrown away too.

## Solution

A feedback loop. Nothing changes model weights; the agents learn through approved
**lessons** injected into their prompts.

1. **Capture.** Every operator override (dismiss with a reason, edit of a script) and
   every validator rejection becomes a **mistake**: agent, order, day, prompt version,
   tags, what the agent said, and what was wrong.
2. **Restate.** A free-text operator reason never reaches the lesson writer. A small
   isolated model call (Haiku, no reasoning, no tools) restates it as a neutral
   correction; code validates the restatement (no instruction-shaped words, no URLs or
   record ids, every number and name must appear in the note or the order's records).
   A failed restatement keeps the mistake but marks it unusable for lessons.
3. **Distil.** Triggered by mistake count (not a schedule): when a group (agent + tags)
   has >= 3 usable mistakes on >= 2 orders across >= 2 days, and >= 2 new ones since its
   last candidate (>= 3 after a rejection), a distil runs in the background. One run at
   a time, each group at most once per hour, a daily spend cap (env, default $2).
   The distiller is **Opus 5.5 with medium thinking** (own setting, env override). It sees
   only restatements, agent output and edit diffs, as quoted JSON marked as data. It
   returns a lesson (one or two plain sentences, <= ~300 chars: the only part injected
   into prompts), an explanation for the operator, the tags it applies to, and the
   mistake ids it is based on. Code verifies the ids exist, belong to the group and meet
   the thresholds, and runs the readability and instruction-word checks.
4. **Gate.** The reviewer eval runs twice without and twice with the candidate (Haiku,
   the agents' own model), including learned cases built from the source mistakes. A
   candidate that lowers the existing score is dropped; one that raises it, or holds it
   while fixing its learned cases, becomes a candidate for the operator.
5. **Operator approves.** A Briefing item ("A new lesson needs your yes") links to a
   Lessons section on the Rules page: the lesson, the explanation, each source mistake
   with the operator's original note and order link, and the eval scores before and
   after. Approve, reject, retire; each an event with time and actor.
6. **Inject what applies.** Approved lessons are tagged (e.g. failing rule ids for the
   reviewer, card kind for plain-words); a call gets only matching lessons. Hard cap of
   10 approved lessons per agent. The cache keys include a hash of the injected lessons.

## Decisions

- Mistakes and lessons survive a demo reset (learning is not wiped); they are neither
  engine state nor content caches.
- Lessons never edit or delete existing eval cases; they may only add learned cases.
- Every model output in the loop is checked by code before it is used.
- No per-operator identity exists yet (one "operator" persona): thresholds count
  distinct orders and days; an `operator` column is kept for when logins exist.

## Out of scope

Fine-tuning, automatic promotion without the operator, lessons for the call agent.
