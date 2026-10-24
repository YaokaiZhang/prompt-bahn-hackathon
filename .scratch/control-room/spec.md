# Spec: Control Room with Document Reviewer and Call Agent

Status: ready-for-agent

Source: `docs/PRD.md` (agreed in the grilling session of 24 Oct 2026). Domain reference: `dataset/SCHEMA.md`.

## Problem Statement

Bahn operators keep every car delivery on track by phone, email and paperwork. One order's records often disagree. A customer note says "use the side gate, reception has the keys". The site says reception has no keys. The endpoint record still says "confirmed". A driver says nothing is booked, yet a train expense is filed on the job.

Today an operator has to do all of the following by hand, for every order:
- find these conflicts;
- work out who can settle them and whether that person pays Bahn;
- make the call;
- update the order.

The starter's lane board shows volume. It doesn't show which orders really need a person. A quiet card only means "no alert", not "checked". Operators can't tell an order that was checked and found normal from one that nobody has looked at.

## Solution

A control room that sorts every order into one of four groups: **Needs action**, **In progress**, **Normal** (checked and normal), and **Done** (finished completely).

**Checking happens in three layers:**
1. Deterministic rule checks.
2. A real LLM Document Reviewer agent on every order whose records the rules can't read (conversations, notes, claims, inbox threads, open alerts and work).
3. A one-time sweep of the quiet orders, so that "Normal" means checked.

**The reviewer's output:** for each conflict it finds, it cites the records that disagree and the record that names the contact. It then drafts who to ask and what to ask.

**Approval:** an approval policy decides what needs an operator's yes. Contact with anyone who pays Bahn needs a yes, and so does any change to the order. Routine questions to pickup sites, sellers' sites, drivers and operators go out on their own.

**Calls run in three tiers, cheapest first:**
1. Fixed questions read by a real TTS voice, answered on a keypad.
2. An LLM voice agent.
3. A human handover.

The calls go to a mock phone page that a teammate opens as the Site or Driver persona. The control room shows the live transcript, the current tier and the cost. Results come back as proposals for approval.

**Briefing:** a Briefing inbox gets scheduled digests and instant urgent pushes. All numbers come from the rules. An LLM writes only the surrounding prose.

## User Stories

### Login and personas
1. As an operator, I want to log in by picking the Operator persona, so that I reach the control room without a password during the demo.
2. As a teammate, I want to log in as the Site persona, so that I can receive the agent's calls as a pickup site, seller's site or dealer branch.
3. As a teammate, I want to log in as the Driver persona, so that I can receive the agent's calls as the assigned driver.
4. As any user, I want the persona to decide my landing page, so that I go straight to the screen I need.
5. As any user, I want to switch persona without restarting, so that one person can run the whole demo.

### Order groups
6. As an operator, I want every order shown in exactly one of four groups, so that I always know where an order stands.
7. As an operator, I want Needs action expanded and sorted by urgency, so that I handle the most pressing case first.
8. As an operator, I want In progress to show orders where an agent is currently acting, so that I don't duplicate its work.
9. As an operator, I want Normal collapsed to a count with a "checked" badge, so that quiet orders stay out of my way but I can trust them.
10. As an operator, I want Done to hold only orders that are finished completely, so that a delivered car with a missing signed handover or a trade-in still on the road doesn't look finished.
11. As an operator, I want each Needs action entry to say why in one line, so that I can triage without opening it.
12. As an operator, I want to search by reference, plate, customer, vehicle or city, so that I can find a specific order quickly.
13. As an operator, I want the group counts to stay consistent between the home page, the order page and the briefing, so that I trust the numbers.
14. As an operator, I want the old lane board available for reference, so that I can compare with how we worked before.

### Checked-normal orders
15. As an operator, I want a Normal order to list what the system checked, so that I can see the coverage.
16. As an operator, I want a Normal order to list what passed, so that I can see why it's considered normal.
17. As an operator, I want a Normal order to list what the system couldn't check (for example "pickup contact not on record" or "confirmed only from the site profile"), so that known gaps aren't hidden.
18. As an operator, I want a Normal order to say "Reviewer read N records, no conflict", so that I know an agent actually read it.
19. As an operator, I want every checked item to link to its source record, so that I can verify it myself.

### Rule checks
20. As an operator, I want deterministic rules to flag orders on their own (missing signed release, no positioning booking, positioning that skips a live duty, promise differing from the customer's requested slot, stale tracking with no alert, missed slot, ETA after promise, positioning expense with no reservation), so that clear problems never depend on an LLM.
21. As an operator, I want weak signals (missing contact, confirmed only from the site profile, promise not set by the customer) to go to "couldn't check" instead of flagging the order, so that common gaps don't flood my queue.
22. As an operator, I want a weak signal on an order whose pickup is within 48 hours to trigger a routine site call when a contact is known, so that gaps close before the driver travels.
23. As an operator, I want rules recomputed only at load, on a clock move or after an effect event, so that pages are fast.

### Document Reviewer agent
24. As an operator, I want the reviewer to run on every order with conversations, messages, notes, endpoint claims, inbox threads naming it, or open alerts, work items or incidents, so that conflicts in free text are found.
25. As an operator, I want the reviewer to sweep every remaining order once at seed time, so that "Normal" means checked.
26. As an operator, I want each finding to cite the exact records that disagree, with the values quoted, so that I can see the conflict at a glance.
27. As an operator, I want each finding to cite the record that names the contact, so that I know where the contact came from.
28. As an operator, I want each finding to name who to ask (site, driver, operator or customer) and why, so that the right person gets the question.
29. As an operator, I want each finding to show who pays Bahn and which policy row applies, so that I know whether my approval is needed.
30. As an operator, I want the reviewer never to ask about data the records already give, so that contacts aren't bothered needlessly.
31. As an operator, I want the reviewer never to re-ask a question that is already open (for example CD-420458, asked at 08:51 with the next check at 10:00), so that we look competent.
32. As an operator, I want the reviewer never to ask a customer about internal problems, so that our internal issues stay internal.
33. As an operator, I want the reviewer never to ask the driver about something the seller is responsible for, so that each question goes to the right party.
34. As an operator, I want the reviewer never to treat a quote as a reservation, an inbox candidate as a confirmed link, a home city as a current location, a SYSTEM or OPS window as customer-approved, or a replaced plan as current, so that its findings respect the evidence.
35. As an operator, I want "nothing to ask" to be a valid reviewer result, so that the agent knows when to stop.
36. As an operator, I want findings whose quotes don't match the cited records to be rejected automatically, so that I never act on invented evidence.
37. As an operator, I want the reviewer to re-run when an effect event, new message or operator instruction changes an order, so that a new conflict goes back to review.
38. As an operator, I want reviewer results cached until the order's records change, so that reports stay fast and cheap.
39. As an operator, I want an order with no contact on record to get no call and no proposal, only a "couldn't check" entry, so that a very common gap doesn't create noise.
40. As an operator, I want the agent to look for a contact first on the order's endpoint, then on the site profile, so that the most specific contact is used.

### Operator approval
41. As an operator, I want a read-only Rules page listing who is contacted, the kind of action, and whether the agent acts alone or needs a yes, so that I understand the agent's authority.
42. As an operator, I want routine questions to pickup sites, sellers' sites, drivers and operators to go out without my approval, and to see their results, so that cheap work happens on its own.
43. As an operator, I want any contact with a paying customer to wait for my yes, so that the agent never contacts a customer on its own.
44. As an operator, I want any change coming out of a call (new date, cost, booking, order update) to wait for my yes, so that nothing changes without a person.
45. As an operator, I want to approve several customer messages in one click, with each script visible, so that approval is fast.
46. As an operator, I want to edit a proposal's script before approving, so that the message says what I want.
47. As an operator, I want to dismiss a proposal, so that a wrong suggestion goes away without losing history.
48. As an operator, I want to tell the agent to act differently and have that instruction saved on the proposal, so that the history shows why the plan changed.
49. As an operator, I want my instruction to be fed into the agent's next run on that order, so that it follows my direction.
50. As an operator, I want an order's history to show finding, approval, call, answer, update approval and effect event in sequence, so that I can audit what happened.

### Calls and the mock phone
51. As a teammate on the phone page, I want the phone to ring with caller ID and order reference, so that it feels like a real call.
52. As a teammate, I want to answer, decline or ignore the call, so that I can test every path.
53. As a teammate, I want the agent first to ask if I'm available and, if not, when to call back, so that I'm not forced to talk.
54. As an operator, I want a declined, unanswered or "busy" call to schedule a callback, so that the agent retries without me.
55. As a teammate, I want tier 1 to read fixed questions in a real TTS voice and accept keypad answers, so that routine checks are cheap.
56. As a teammate, I want a wrong key, an "it's complicated" option or a reported problem to hand me to a voice agent, so that I can explain in my own words.
57. As a teammate, I want to speak through the microphone with push-to-talk in tier 2, so that the conversation is natural and reliable.
58. As a teammate, I want the voice agent to know the order, the question and the records that disagree, so that I don't repeat what Bahn already knows.
59. As an operator, I want an unresolved tier-2 call to end politely and hand me the transcript, a summary, the open question and a proposed next step, so that I can take over quickly.
60. As an operator, I want to see the live transcript, the current tier and the running cost of a call in the control room, so that I can see the cost saving.
61. As an operator, I want the cost meter to compare the call's real model cost and mock phone cost with what an operator would have cost, so that the value of cheap-first is obvious.
62. As an operator, I want the call result written to the order and any change sent to the approval queue, so that the call's outcome is recorded and governed.
63. As a demo runner, I want optional auto-answer scripts per scenario, so that I can run the demo alone.
64. As a teammate, I want no real phone numbers involved, so that nothing real is contacted.

### Demo journeys
65. As an operator, I want CD-420437 to show the receiver-authority conflict and a drafted call to the buyer (Calverona Auto) that needs my yes, so that I can approve a customer contact (journey 1).
66. As an operator, I want an approved buyer call on CD-420437 to ring on the Site persona's phone as "Calverona Auto", so that the approval gate visibly lets a real call through.
67. As an operator, I want an answer naming a different receiver to create a new conflict and send the order back to review, so that the loop is shown.
68. As a site teammate, I want CD-420516 to call me without approval about who holds the keys, so that the routine site call journey is shown.
69. As an operator, I want site calls with a next check at 10:00 (ord-00516, ord-00458, CD-420015) to fire when the clock reaches 10:00, so that scheduled checks work.
70. As a driver teammate, I want CD-420806 to give me a tier-1 "still on track? press 1" check-in, so that the cheap path that ends without a person is shown.
71. As a driver teammate, I want CD-420437 to ask whether I can still deliver on time and hand me to the voice agent if I report a problem, so that the escalation path is shown.
72. As an operator, I want CD-420089 to ask me, in the app, whether the Lahti train in my colleague's note is still right, so that operator clarification is shown.
73. As an operator, I want CD-420399 to ask the driver which trip the €137.10 train claim was for, so that the expense conflict is shown.

### Clock and reset
74. As a demo runner, I want "now" to start at 2026-10-21T09:00Z, so that deadlines don't all look late.
75. As a demo runner, I want to advance the clock by 15 minutes or to the next due item, so that callbacks and scheduled checks fire on demand.
76. As a demo runner, I want a reset button that clears all agent and approval state, so that I can repeat a take.

### Briefing
77. As an operator, I want a Briefing inbox styled like email, so that summaries feel familiar.
78. As an operator, I want digests at 09:00, 12:00 and 16:00 on the demo clock, so that I get a regular overview.
79. As an operator, I want an instant push when an order becomes urgent or a tier-3 handover arrives, at most once per order per reason, so that I'm alerted without spam.
80. As an operator, I want a toast and a badge in the control room for new pushes, so that I notice them.
81. As an operator, I want all counts in a digest to come from the rules, so that the numbers are always right.
82. As an operator, I want an LLM to write a short opener, order the urgent items, group similar cases and suggest a first move, so that the digest reads well.
83. As an operator, I want the digest to fall back to template text if the LLM fails or is slow, so that a summary is never late or wrong.
84. As an operator, I want urgent items defined as: an action due within 2 hours, a promise at risk today, or a pickup within 24 hours with no confirmed contact or release, so that "urgent" is predictable.
85. As an operator, I want every line in a digest to link to its order, so that I can act directly.

### Evidence and trust
86. As an operator, I want conflicting fields highlighted in the order view, so that I see the conflict without reading every record.
87. As an operator, I want every fact to show its source, author and time, so that I can see where it came from.
88. As an operator, I want order changes to be shown as committed only when an effect event exists, so that proposal text is never mistaken for fact.

## Implementation Decisions

### Keep the starter's data layer, rebuild the UI
- The seed, schema, attachment store and reading layer stay. That includes the per-order `Bundle` loader, the label and actor mapping, and the time handling.
- The lane board, the order page layout and the components are replaced by new pages built on the coming UI design template.
- The lane board stays on a separate route for reference.
- The starter's attention derivation is used only as a cross-check.

### The operations engine is the single seam the UI and API talk to
- **Reading:** `state(now)` returns per-order group, rule results (checked, passed and couldn't-check), urgency flags, proposals, call states, and the digest facts.
- **Changing:** `apply(command)` takes these commands:
  - approve, approve a batch, edit script, dismiss, give an instruction;
  - start a call, record a call event, record a call outcome;
  - answer an operator question;
  - advance the clock;
  - reset.
- **Dependencies:** the engine is built from the snapshot bundles, a store port (Postgres in the app, in-memory in tests), a clock, and a `ModelGateway` port.

### `ModelGateway` port
Every model call goes through it, and every call reports its `usage.cost`. Everything goes through OpenRouter:

| Job | Model | Notes |
|---|---|---|
| Reviewer and other reasoning | `anthropic/claude-haiku-5.5` | Effort set per job: medium for the reviewer and call summaries, low for the digest. |
| Speech | `openai/gpt-4o-mini-tts` | Tier-1 prompts are generated once and cached. |
| Tier-2 live voice | An audio-in, audio-out chat model such as `openai/gpt-4o-audio-preview`, streamed | Haiku runs on each turn's transcript to check evidence and policy and to write the structured result. |
| Tier-2 fallback | An audio-input or transcription model (`openai/whisper-large-v3`) as the ear | Haiku replies, TTS speaks. |

### Our own tables
- New tables with no foreign keys to the starter tables, so reseeding keeps working:
  - review results (keyed by order and case-file hash);
  - proposals and proposal history;
  - operator instructions;
  - calls, call turns and call costs;
  - callbacks;
  - effect events;
  - digests and pushes;
  - demo clock.
- Reset truncates only these tables.
- Effect events are append-only. The view applies them on top of the snapshot, and seed data is never changed.

### Grouping
- An order is in exactly one group, with precedence Needs action, then In progress, then Done, then Normal.
- **Needs action:** a proposal is waiting for a yes, a tier-3 handover is open, an operator question is unanswered, or an order is flagged with no plan yet.
- **In progress:** a call is running, a callback is scheduled, or the agent is waiting on a reply.
- **Done:** delivered or cancelled, with no open proof, claim, alert, work item, proposal, custody follow-up or moving trade-in.
- **Normal:** everything else that passed the rules and the reviewer.

### Rules
- Pure functions over a bundle plus the effect events and the clock.
- **Strong rules that flag an order:**
  - signed release required but no verified release-authority document;
  - no positioning booking;
  - positioning that skips another live duty;
  - selected promise differs from the requested slot;
  - in transit with tracking missing or older than 4 h and no open alert;
  - pickup slot passed with no pickup;
  - ETA after the promise end;
  - positioning expense with no reservation.
- **Weak rules** (contact missing, confirmed only from the site profile, promise source not the customer) feed "couldn't check". They become a tier-1 site call when pickup is within 48 h and a contact is known.
- **Urgency** is computed from the rules and the clock.

### Reviewer context
- **Fresh per order:** one fresh context per order per run.
- **System prompt:** stable and cached (`cache_control` through OpenRouter). It holds the role, the "what not to ask" rules, the policy table, and a condensed schema.
- **Prepared case file as the first message:**
  - normalised records, oldest first, each with record ID, time, source and `stated_by`;
  - local times already resolved, and "now";
  - rule results;
  - prior state: findings, open questions, operator instructions, call results.
- **Read-only tools** for what lies outside the order: driver's other duties, related orders, site profile, inbox threads naming the order, policy. At most 8 calls.
- **Output:** a `submit_findings` structured tool call. Each finding holds conflict records with quoted values, contact record, contact role, who pays, policy row, draft question and reason.
- **Validation:** the server checks that cited records exist and that quotes match. A failing finding gets one repair attempt and is then dropped.
- **Cache key:** a hash of the case file.

### Contact lookup
- The order's endpoint contact, then the site profile email. If neither exists, there is no call and no proposal.
- Drivers are addressed by driver ID.
- Whether approval is needed depends on whether the contacted party is the order's paying customer, never on which persona answers.

### Approval policy
- A config table: contact type × action type → acts alone or needs a yes.
- Rendered read-only on the Rules page and cited by every proposal.

### Call state machine
| Step | State |
|---|---|
| Start | ringing |
| Ringing ends as | answered, declined or no answer |
| After answering | availability check (if not available, schedule a callback) |
| Tier 1 | keypad questions |
| Tier 1 ends as | resolved, or escalated to tier 2 |
| Tier 2 ends as | resolved, or handed over to tier 3 |
| End | ended, with an outcome |

- Callbacks fire when the demo clock reaches them.
- Call events stream to the control room for the live transcript, tier and cost.
- The cost is the summed model `usage.cost`, plus €0.01 per minute of mock phone time, compared with a configurable €0.70 per operator-minute.

### Mock phone page
- Opened by the Site and Driver personas. It joins the call's event stream.
- Answering is a user gesture, which also unlocks audio and the microphone.
- Tier 1 shows a keypad. Tier 2 uses push-to-talk.
- Auto-answer scripts per scenario drive the same events.

### Digest
- `digest_facts` are built from the rules with no LLM.
- Haiku (low effort) writes the prose using placeholders for counts and order references. The server fills them in and rejects stray digits. The counts block is always a template.
- Fallback to the template within about 5 s. Output is cached by a hash of the facts.
- Urgent pushes are template-only.
- Delivery is in-app only: Briefing inbox, toast and badge.

### Login
- A persona cookie set by a picker page, with no password.
- Basic auth in front of the site is added at publish time, outside the app.

## Testing Decisions

- **What a good test is:** it checks external behaviour through the operations engine only: groups, findings, proposals, policy rows, effect events, call outcomes and digest facts for given inputs. It never checks private helpers or the database layout.
- **Engine tests:**
  - **Setup:** built from the real dataset files, with the clock fixed at 2026-10-21T09:00Z, an in-memory store, and a scripted `ModelGateway` that replays recorded reviewer findings and call turns.
  - **Cases to cover:**
    - each demo case lands in the expected group with the expected reason;
    - CD-420437's buyer contact needs a yes and cites its policy row;
    - CD-420516's site call goes out without approval;
    - CD-420458 produces no new question;
    - an order with no contact gets no proposal;
    - approval leads to call, then outcome, then a change proposal, then an effect event, then a re-review;
    - a decline schedules a callback that fires on a clock move;
    - the reset clears state;
    - Done excludes delivered orders that still have gaps;
    - digest counts equal the group counts;
    - LLM text with a stray digit is rejected;
    - evidence validation drops a finding with a wrong quote.
- **Reviewer eval:**
  - **What it runs:** the real model on CD-420516, CD-420437, CD-420089, CD-420399 and CD-420458, plus CD-420656 and CD-420311.
  - **What it scores:** cited records, contact and role, approval classification, and no re-asking.
  - **How it reports:** as a score and stored traces, not as CI pass or fail.
  - **Re-running:** it can be re-run on modified data through the starter's `DATASET_DIR` mechanism.
- **HTTP smoke checks:** extended in the style of the existing starter smoke script, which compares JSONL with the API. They check that every order's group is the same on the overview and the order endpoints, and that the counts match the briefing.
- **Manual checks:** the mock phone page and the audio are checked by hand as part of the demo rehearsal.
- **Prior art:** the starter's smoke and attachment smoke scripts. No unit-test framework exists yet; add a lightweight TypeScript test runner for the engine tests.

## Out of Scope

- Real phone numbers, real email or push, real bookings, real customers.
- A live operator joining a call (tier 3 is an asynchronous handover).
- Editing the seed snapshot.
- Real authentication.
- The travel planner and the mock driver travel site. They are a stretch goal with a separate spec if built. Their triggers are CD-420399 and CD-420311.
- The final visual design. The UI design template is still to come, and this spec defines behaviour and content, not styling.
- Browser Web Push notifications.

## Further Notes

- The dataset is a fixed snapshot. Without the demo clock, every deadline shows as late.
- Missing contacts are common (57 of 200 endpoints have no handle). Site profiles all carry a contact email but no phone or named person. Calls are mocked, so a handle is enough to identify the callee.
- On the strong rules, about 21 orders flag and about 79 are expected to be checked normal.
- One order's records take about 4k tokens at the median and 9k at most, so the case file fits a single call.
- OpenRouter's pages disagree on whether Haiku 5.5 thinking can be disabled. Set effort explicitly per job.
- Audio-model latency and tool use over streaming are the main technical risk. The tier-2 fallback pipeline exists for that.
