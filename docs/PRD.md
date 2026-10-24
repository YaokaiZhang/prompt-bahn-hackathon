# PRD: Car Delivery Control Room with a Document Reviewer and Call Agent

Status: agreed draft, 24 Oct 2026. Built on the starter app and dataset in this repo.
Open inputs still to come: the UI design template (sketch 7) and the travel planner (stretch).

## 1. Problem

Bahn's operations team holds every delivery together by phone, email and paperwork. The records about one order often disagree: a customer message names a side gate, the site says reception has no keys, and the endpoint record still says "confirmed". Today a person has to find these conflicts, decide whom to ask, make the call, and update the order.

We want agents to do the cheap work first (read, compare, ask) and bring a person only the orders that need a decision, with the evidence and a ready-to-approve next step.

## 2. Goals

1. **Three-group control room.** Operators see every order in one of three groups: **Normal** (checked and normal, not only "no alert"), **Needs action**, and **In progress or done**.
2. **One real agent: the Document Reviewer.** An LLM in a tool loop that finds conflicting or wrong information in an order's records and decides who to ask, what to ask, and why.
3. **Approvals that follow the brief's rules.** Nothing that changes the order or contacts a paying customer happens without a person's yes. Routine questions to sites and drivers go out on their own.
4. **An action agent with a three-tier mock call.** Fixed keypad questions first, then an LLM voice agent, then a human, with live transcript, tier and cost shown in the control room.
5. **Fast, honest reporting.** Rule checks run once at load. LLM results are cached. A briefing gives counts and urgent reminders from the rules, not from an LLM.

### Non-goals

- Real phone numbers, real email, real bookings or real customers. Everything external is mocked.
- A live operator joining a call (tier 3 is asynchronous).
- Editing the seed snapshot. All changes are overlays.
- Real authentication (a reverse-proxy basic-auth is added at publish time).
- Travel planner in the must-have scope (see §11).

## 3. Users and personas

The login is a persona picker with no password, stored in a cookie. The persona sets the landing page.

| Persona | Who | Lands on |
|---|---|---|
| **Operator** (operator manager / admin) | Bahn operations staff | Control room home |
| **Site** | A teammate playing whoever answers the phone at a place: a seller's site, a pickup yard, or a dealer branch that pays Bahn | Mock phone page |
| **Driver** | A teammate playing the assigned driver | Mock phone page (and the travel page, if built) |

There is no separate customer login. A paying customer (the dealer or buyer) is reached through the Site persona's phone page. **Whether a contact needs approval depends on who pays Bahn (`orders.customer_id`), not on which persona answers.**

## 4. Key concepts

- **Snapshot time.** "Now" starts at `2026-10-21T09:00:00Z`. A demo-only **advance clock** control (+15 min, or jump to the next due item) moves it forward, runs callbacks that are due, and re-runs the rule checks.
- **Effect event.** An append-only record in our tables of a committed change (new slot, cost, booking, contact confirmed, and so on). The view layer applies effect events on top of the snapshot. The seed is never mutated. Proposal text is never a source of truth; only an effect event is.
- **Proposal.** Something an agent wants to do: a question, a call, or an order change. It carries evidence record IDs, the contact, who pays, the policy row that applies, and its history.
- **Policy row.** One line of the approval policy (§7) that decides whether an action needs a yes.

## 5. Order groups and checking (sketches 1, 8)

### 5.1 Three layers of checking

1. **Strong rule checks.** Deterministic, computed once at load and again only after a clock move or an effect event. They flag orders on their own.
2. **Records the rules can't read.** An order also goes to the reviewer when it has open conversations, new messages or notes, endpoint claims, inbox threads naming it (candidate or linked), or open alerts, work items or incidents.
3. **One-time sweep of quiet orders.** At seed time the reviewer runs once on every remaining order, so Normal really means checked. A Normal order shows "Reviewer read N records, no conflict".

Reviewer results are cached in Postgres, keyed by a hash of the order's records plus overlays. An effect event on an order invalidates its cache and re-runs the reviewer, so if an answer creates a new conflict, the order goes back to the reviewer.

### 5.2 Initial rule set

Computed from the dataset fields. Counts are from the snapshot.

| ID | Rule | Source fields | Flags |
|---|---|---|---|
| R1 | Site requires a signed release, and there is no verified RELEASE_AUTHORITY document before pickup | `sites.requires_signed_release`, `documents` | ~10 |
| R2 | Assigned driver has no positioning booking | `work_assignments.positioning.travel_commitment_status` | 4 |
| R3 | Positioning's previous duty skips another live duty of the same driver | assignments + selected windows | 1 real (CD-420089) |
| R7 | Selected promise differs from the customer's requested delivery slot | `time_windows` | 5 |
| R10 | In transit, tracking missing or older than 4 h, no open alert | `tracking_observations`, `alerts` | 4 |
| R11 | Pickup slot passed with no pickup recorded | windows, events | ≥1 |
| R12 | Latest ETA after the promise end | tracking, windows | ≥1 |
| R13 | Positioning expense with no matching reservation | `expenses`, `travel_reservations` | 3 |

These signals don't flag an order on their own. They go on the order's **"couldn't check"** list instead:

- **R4**: the pickup was confirmed only from the site profile (17 orders).
- **R5**: the contact name or handle is missing (59 orders).
- **R6**: the promise source isn't the customer (8 orders).

If pickup is within 48 h and a contact is known, they trigger a tier-1 site call that needs no approval.

On the strong rules, about 21 orders are flagged and about 79 come out "checked normal".

### 5.3 Groups

| Group | Meaning |
|---|---|
| **Needs action** | A proposal is waiting for a yes, a tier-3 handover is open, or a flagged order has no plan yet. Sorted by urgency (§9), expanded by default. |
| **In progress or done** | An agent action is running (call in progress, callback scheduled, waiting on a reply) or was completed with its result recorded. |
| **Normal** | All rule checks pass and the reviewer found no conflict. Collapsed to a count with a "checked" badge. |

### 5.4 Opening a Normal order

A Normal order shows three lists:

- **What the system checked:** each rule, plus "Reviewer read N records".
- **What passed.**
- **What it couldn't check:** for example "pickup contact not on record" or "confirmed only from the site profile".

Each list item links to its source records.

## 6. Document Reviewer agent (sketch 2)

### 6.1 Behaviour

- **Model:** `anthropic/claude-haiku-5.5` via OpenRouter, medium reasoning effort.
- **Inputs:** one order's records, including messages, notes, endpoint details and claims, windows, assignments, travel, expenses, documents, alerts, work items, inbox threads, and overlays. `dataset/SCHEMA.md` is the reference for field meaning.
- **Tools (read-only):**
  - `get_order_records`
  - `get_site_profile`
  - `get_driver_duties`
  - `get_related_orders`
  - `get_inbox_threads`
  - `get_policy`
  - `now()`
- **Output:** structured findings. Each finding has:
  - `conflict`: the records that disagree, by ID, with the quoted values;
  - `ask`: whom (site, driver, operator, customer) and the contact record that names them;
  - `who_pays`;
  - `policy_row`;
  - `question`: the draft script;
  - `why`.
  A finding of "nothing to ask" is allowed and expected.
- **Evidence:** every question cites the records that don't agree and the record that names the contact. The UI highlights those fields.

### 6.2 What it must not do

- Ask about data the records already give.
- Re-ask a question that is already open. For example, CD-420458 was asked at 08:51 with the next check at 10:00, so the agent waits.
- Ask a customer about internal problems.
- Ask the driver about something the seller is responsible for.
- Treat a quote as a reservation, an inbox candidate as a confirmed link, a home city as a current location, a SYSTEM or OPS window as customer-approved, or a replaced plan as current.

### 6.3 Finding a contact

1. The order's own endpoint contact (`order_endpoint_details.contact_handle`).
2. The site profile's `pickup_contact_email`. All 71 site profiles have one; none has a phone or a named person, which is fine because calls are mocked.
3. If neither exists, there is **no call and no proposal**. The gap goes on the "couldn't check" list. Missing contacts are common and don't warrant action on their own.

Drivers are reached through the app or phone channel, keyed by driver ID.

### 6.4 Test and demo cases

These come from the dataset. Each is a fixture with expected findings.

| Case | Conflict (abridged) | Ask | Needs a yes |
|---|---|---|---|
| **CD-420516** | Customer note: "use the side gate", "reception has the keys". Site: reception has no keys, side gate is vehicles only. Profile: collection bay. Contact still CONFIRMED from the profile. | Site (stock control): who holds the keys, at which desk | No |
| **CD-420437** | "Contact only until early afternoon" vs a correction "until 18:00, can't confirm who signs". Promise is 11:00–16:00 local, and the ETA has slipped to about 16:00. The follow-up task is overdue. | Buyer (cus-025, Calverona Auto): is Celia Hollowmere authorised to sign; if not, who | **Yes**, customer |
| **CD-420089** | An ops-shift note and a booked Lahti→Espoo train assume drv-055 starts in Lahti. Their CD-420719 duty actually ends in Helsinki on 23 Oct. | Operator (note author): is the Lahti train still right | No |
| **CD-420399** | Driver: "I have no travel booking". A €137.10 train positioning expense is filed on this assignment, dated a time when the driver was mid-duty on CD-420326. | Driver: which trip the claim was for | No (any slot change is a yes) |
| **CD-420458** | The seller withdrew release permission. The customer was already asked at 08:51, next check 10:00. | Nobody yet. Negative test: wait. | — |

Further test cases:

- **CD-420656:** customer says the workshop is waiting on a part, vs the endpoint CONFIRMED and the site's Friday queue. Ask the site, then propose a slot change, which needs a yes.
- **CD-420311:** the only travel quote leaves from Pori, the driver's home city, but the previous duty ends in Helsinki.

## 7. Operator approval (sketch 3)

### 7.1 Policy table

A config file, shown read-only on a **Rules** page. Every proposal cites its row. Loosening a rule later is a one-line change.

| Contact | Action | Default |
|---|---|---|
| Pickup site or seller's site (not paying) | Routine question or call | Agent does it |
| Driver | Routine question or call | Agent does it |
| Operator | Clarifying question | Agent does it |
| Paying customer (dealer or buyer) | Any contact | **Needs a yes** |
| Anyone | Order change from a call (new date, cost, booking, order update) | **Needs a yes** |

Example routine questions: "Is the car ready?", "Are the papers there?", "What documents do you need for the pickup?", "Can you still deliver on time?". The operator sees the results.

### 7.2 Approval UX

- **Batch approve.** Several customer messages can be approved in one click, with each script visible inline.
- **Per proposal.** The operator can approve, edit the script, dismiss, or tell the agent to act differently. The instruction is saved on the proposal, so the history shows why the plan changed.
- **Who pays.** Each contact shows who pays and which policy row applies.
- **On approval.** The action agent runs. Any resulting change comes back as a new proposal.

## 8. Action agent and mock call (sketch 4)

### 8.1 Tiers, cheapest first

1. **Tier 1, fixed questions.** Pre-generated speech (`openai/gpt-4o-mini-tts` via OpenRouter, cached per script) and keypad answers, for example "Is the car ready? Press 1 for yes, 0 for no." No LLM is involved.
2. **Tier 2, voice agent.** Triggered by an unclear answer, a wrong key, a "it's complicated" option, or a reported problem. It uses a hybrid design:
   - An **audio-in, audio-out model** via OpenRouter (for example `openai/gpt-4o-audio-preview`, streamed) runs the live conversation, with push-to-talk.
   - **Haiku 5.5** at medium effort runs on each turn's transcript in the background. It checks the conversation against the order evidence and the policy, and it writes the structured result and the handover.
   - It knows the order, the question, and the records that don't agree.
   - **Fallback** if audio-model streaming or tool use is unreliable: an audio-input model transcribes, Haiku replies at low effort, and TTS speaks.
3. **Tier 3, human.** If tier 2 can't resolve it, the call ends politely ("a colleague will call you back"). The operator gets a task with the transcript, a summary, the open question and a proposed next step.

**Unavailable.** On no answer, a decline, or "busy", the agent asks when to call back if it can, and schedules a callback. The callback fires when the demo clock reaches it.

### 8.2 Mock phone page (Site and Driver personas)

- The phone rings with the caller ID and the order. The teammate can answer, decline, or ignore it.
- Tier 1 plays the real TTS voice and shows a keypad. Tier 2 uses a hold-to-speak microphone and plays the agent's voice.
- **Auto-answer scripts** per scenario (for example 1, then 0, then "the papers are missing") let the demo run solo. Live teammate mode is the hero of the demo.
- No real phone numbers are used.

### 8.3 Live view in the control room

- The live transcript, the current tier, and a running cost meter.
- **Cost meter:**
  - real OpenRouter `usage.cost` for every LLM, TTS and STT call;
  - a pretend phone rate of €0.01 per minute;
  - a comparison line: "same call by an operator: €X", at an assumed €0.70 per operator-minute (configurable).
- **End of call.** The agent writes the result to the order as call record events. Any change (new slot, cost, booking, contact confirmed) goes to the approval queue.

## 9. Summaries and urgency (sketch 5)

- **Briefing page:** in-app, styled like an email, with a copyable or mailto version. Nothing is really sent.
- **Counts:** from the rule engine only. They cover Needs action by reason, In progress, Normal, and couldn't-check gaps.
- **Urgent reminder** at the top. An order is urgent when any of these holds:
  - an action is due within 2 h of the demo clock;
  - a promise is at risk today (ETA after the promise end);
  - pickup is within 24 h with no confirmed contact or release.

  On the snapshot this covers CD-420437, CD-420516 and CD-420458.

## 10. User journeys and acceptance criteria

### J1. Operator resolves a document conflict (CD-420437)

1. The operator logs in by picking the Operator persona.
2. They open the Briefing. CD-420437 is in the urgent block.
3. They open the order. The conflicting records are highlighted (contact-hours messages, the promise window, the slipping ETA, the overdue work item), and the draft call to the buyer is shown with "who pays: Calverona Auto, cus-025 → needs a yes".
4. They edit the script or approve it. Any instruction they give is saved on the proposal.
5. The Site persona's phone rings as "Calverona Auto". A teammate or the auto-answer script answers.
6. The agent records the answer and moves the task state to answered.
7. A proposal to update the order (for example "receiver: Celia Hollowmere confirmed until 18:00") appears. The operator approves it, and an effect event is written.
8. **Variant:** the scripted answer names a different receiver. That creates a new conflict, and the order goes back to the reviewer.

**Acceptance criteria:**

- No customer contact happens before approval.
- Every question cites the records that disagree and the record that names the contact.
- The order history shows the reviewer finding, the approval, the call, the answer, the update approval and the effect event.

### J2. Site receives a routine call (CD-420516; also ord-00458 and CD-420015 at the 10:00 check)

1. No approval is needed. The call starts from the reviewer finding, or when the clock reaches the next check.
2. The agent asks if the person is available. If not, it asks when to call back and schedules the callback.
3. Fixed keypad questions: "Is the car ready?", "Are the papers there?".
4. If a problem is reported, tier 2 takes over and the person explains in their own words.
5. The result is written to the order. Any change goes to approval.

**Acceptance criteria:** the control room shows the tier changes and the cost live, and a tier-1-only call costs about €0 in LLM spend.

### J3. Driver calls

- **CD-420806:** a tier-1 check-in, because the last position is 6.7 h old. "Still on track? Press 1." It ends without a person. The car isn't actually late; the customer's worry came from a time-zone mistake.
- **CD-420437:** "Can you still deliver on time?" The driver reports a problem, tier 2 asks for details, and the next step is proposed to a person.

### J4. Operator asks about their own log entry (CD-420089)

The reviewer asks the operator in-app whether the Lahti→Espoo train still holds, given that the CD-420719 duty ends in Helsinki. The operator's answer is recorded, and any change becomes a proposal.

### J5. Operator plans driver travel (stretch, §11)

## 11. Travel planner (stretch, sketch 6)

Built only if time allows. It would start with a mocked UI and deterministic options, without an LLM.

- **Triggers:** an assignment whose driver has no booked way to reach pickup, or whose plan doesn't work.
  - **CD-420399:** the plan is broken. The driver needs rest after CD-420326 and can't make the slot.
  - **CD-420311:** no booking, and the only quote starts from the home city, Pori, instead of Helsinki.
  - CD-420405 and CD-420656 stay in the reviewer queue for their real conflicts.
- **Flow:**
  1. The agent proposes a set of options (ferry, flight, hotel, train, parking) and a budget, using mocked distance and navigation data.
  2. The operator approves the set and the budget.
  3. The driver picks one option on a mock travel site. This needs no new approval.
  4. If the driver disagrees, the agent makes a new proposal for the operator.
  5. Booking is mocked if Bahn books that type of travel. Otherwise the option is shown to the driver as a reference within the budget.

## 12. Architecture

- **App:** the starter (Next.js, TypeScript, Postgres, Drizzle). The home page is replaced by the three groups. The old lane board stays at `/board` for reference.
- **Our tables:** separate tables with no foreign keys to the starter tables, so reseeding still works:
  - `review_results` (cached per order by hash)
  - `proposals` and `proposal_history`
  - `calls`, `call_turns` and `call_costs`
  - `callbacks`
  - `effect_events`
  - `operator_instructions`
  - `demo_clock`
- **Reset demo:** a button that truncates our tables.
- **Rule engine:** pure functions over the loaded snapshot plus effect events. They run at load and after a clock move or an effect event.
- **LLM gateway:** OpenRouter only.
  - Haiku 5.5 (`anthropic/claude-haiku-5.5`) for reasoning.
  - `openai/gpt-4o-mini-tts` for speech.
  - An audio chat model for tier 2.
  - `openai/whisper-large-v3` or an audio-input model for the fallback.
  - Each call logs its `usage.cost`.
- **Seed-time sweep:** a `review:all` script that runs the reviewer on all orders and fills the cache.
- **Config:** `OPENROUTER_API_KEY`, the operator €/min rate, and the policy file.

## 13. Speed

- Rule checks run once per load, clock move or effect event, never per request.
- The LLM runs only for layers 2 and 3 of §5.1. Results are cached and reused until the order's hash changes.
- The Briefing and group counts read only from the rule results and cached reviews.

## 14. Polish (sketch 7)

The UI design template is still to come. The brief's taste bar applies:

- It must work for operators, not engineers.
- Calm, high-signal pages.
- Sensible empty and loading states.
- Every fact links to its source record.

## 15. Risks and open items

- **Audio-model latency and tool use over OpenRouter streaming.** Mitigation: the fallback pipeline in §8.1.
- **Haiku 5.5 thinking controls.** OpenRouter's pages disagree on whether thinking can be turned off. We set the effort level explicitly per job.
- **Browser microphone permission and autoplay.** The phone page needs a user gesture to answer, which also unlocks audio.
- **Still to come:** the UI template and the travel planner decision.
