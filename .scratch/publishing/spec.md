# Publishing and the travel planner

Status: ready-for-agent

## Problem Statement

The control room sorts every order into groups, but nothing happens after that. An order that is checked and fine still sits in "Ready to post" until a person posts it by hand. When the agent's calls settled a conflict, the operator cannot see what the calls changed before the job goes out to drivers. Drivers who take a long cross-country job get no help with the trip itself: hotels, trains or ferries.

## Solution

Publishing becomes part of the flow for orders that are not on the driver market yet (dataset lanes "New orders" and "Ready to post"):

- **Normal** orders the reviewer has read are published by the agent at once: they move to **Finding a driver**.
- **In progress** and **Needs action** keep their groups and columns until their work is done.
- A new group, **Solved**, holds orders where the agent's calls settled the open questions. Before publishing, they wait in **Confirm before publishing**. For each point the calls settled, the operator sees the rewritten answer (what the records said before, what the call says now) and the call transcripts. The operator's approval confirms the changes and publishes the order.
- Delivered and cancelled orders with nothing open are **Finished** (the group was called "Done").

Before an order in Finding a driver reaches drivers, a **demand filter** decides whether it is a demanding order: cross-country, more than 12 hours of driving, or a train or ferry needed between the endpoints. A demanding order goes to the **travel planner**, an agent that drafts a rough travel plan within the order's travel budget: getting the driver to pickup, a hotel when the drive needs a night stop, ferry or train tickets, and the way home. The plan is a recommendation only. Drivers see it with the job on their phone. The operator sees it folded away at the bottom of the order page.

## User Stories

1. As an operator, I want a Normal order that is not on the market yet to be published by the agent without me, so that checked orders reach drivers without my clicks.
2. As an operator, I want the agent to publish only orders the reviewer has read, so that an unread order never goes out on the rules alone.
3. As an operator, I want In progress and Needs action orders to stay where they are, so that the agent's work and my decisions finish before anything is published.
4. As an operator, I want a Solved group for orders whose open points the agent's calls settled, so that I can see what the agent changed.
5. As an operator, I want Solved orders that are not on the market yet to wait in "Confirm before publishing", so that nothing the calls changed goes out to drivers without my yes.
6. As an operator, I want each settled point shown as a rewrite (before: what the records said, after: what the call says now), so that I can judge the change in seconds.
7. As an operator, I want the transcript of each call that settled a point, so that I can check what was actually said.
8. As an operator, I want one "Approve and publish" button, so that confirming the changes and publishing is one decision.
9. As an operator, I want a Solved order already on the market to only need my confirmation, so that the group means the same thing for every order.
10. As an operator, I want an order to come back to Solved when a later call changes something new, so that every call result is confirmed once.
11. As an operator, I want to publish a Normal order myself, so that I can post it even when the reviewer has not run (no model key).
12. As an operator, I want delivered and cancelled orders in a Finished group, so that they are not confused with Solved.
13. As an operator, I want the lane board to show "Confirm before publishing" between "Ready to post" and "Finding a driver", and published orders under "Finding a driver", so that the board shows the real stage.
14. As an operator, I want every order in Finding a driver checked by the demand filter, so that long jobs are recognised before drivers see them.
15. As an operator, I want the filter to give its reasons (countries, hours of driving, ferry or train), so that I can see why a job counts as demanding.
16. As an operator, I want a published order to reach drivers only after the filter, and for demanding jobs after the plan, so that a driver never sees a demanding job without its plan.
17. As a driver, I want open jobs on my phone, so that I can see what is on the market.
18. As a driver, I want a suggested travel plan on a demanding job, folded away, so that I can see how to get there, where to sleep and what tickets to buy.
19. As a driver, I want the plan marked as a suggestion with rough prices against the budget, so that I know nothing is booked.
20. As an operator, I want the travel plan at the bottom of the order page, collapsed, so that it is there when I need it and out of the way otherwise.
21. As an operator, I want each order's travel budget shown with the plan, so that I can see whether the plan fits it.
22. As an operator, I want the planner to use the order's places, pickup and delivery windows, route, the dataset's travel quotes and the ferry terminals, so that the plan fits the job.
23. As an operator, I want a plan to say when it goes over budget, so that the overrun is visible.
24. As an operator, I want plans cached, so that a demo replay costs no model calls.
25. As an operator, I want a rough template plan when no model key is set, so that the flow works without one.

## Implementation Decisions

- **Who is in the flow.** Only orders whose dataset lane is New orders or Ready to post can be published. Orders already Finding a driver are on the market and go straight to the filter and planner. Orders with a driver or further along keep their dataset lane.
- **Groups.** `needs_action`, `in_progress`, `solved`, `normal`, `done` (shown as "Finished"). Precedence: Needs action, then In progress, then Finished (finished with nothing open), then Solved, then Normal.
- **Solved.** The order has call results the agent committed (`call_result_recorded` or `eta_reported`, by the agent) that the operator has not confirmed, and nothing else is open. Results the operator wrote (a closed handover) need no confirmation.
- **Rewrite.** For each pending call result: the point it settles (its fact label), "before" (the records it superseded, read as one line each from the snapshot, plus the rule or check that asked), "after" (the claim or reported ETA), and the call's transcript.
- **Publications are their own append-only store table** (`cr_publication_events`), not effect events. Effect events change the order's records, which re-reviews the order. Publishing changes no record, only the order's stage. Event kinds: `published`, `confirmed` (with the effect ids it confirms), `filtered` (the filter's result), `planned` (the plan), `plan_failed`.
- **Policy (ADR 0003).** The agent may publish a Normal, reviewed order alone. Confirming call results, and so publishing a Solved order, is the operator's.
- **Commands.**
  - `publish` (operator; a Normal or Solved order not on the market; for Solved it also confirms).
  - `confirmChanges` (operator; a Solved order; publishes it when it is not on the market yet).
  - `runPublishing` (the agent's loop: publish reviewed Normal orders, filter every order in Finding a driver, plan demanding ones).
- **The pump.** The server runs `runPublishing` on its own interval, next to the call pump.
- **Display lane.** An unposted order that is published shows as Finding a driver. One that is Solved and not published shows as Confirm before publishing. The dataset's lane stays as seeded (ADR 0002).
- **Demand filter.** Deterministic, with reasons:
  - cross-country: the pickup and delivery countries differ;
  - long drive: route km / 75 km/h > 12 h;
  - crossing: a `DRIVE_WITH_FERRY` segment, or travel quotes of kind FERRY or TRAIN on the order.
- **Travel budget.** A whole number of euros from 30 to 200, fixed per order from its reference. It is a stand-in until real budgets exist.
- **Travel planner.**
  - **Inputs:** the order's pickup and delivery places and countries, windows (pickup slot, delivery promise), route km and modes, the filter's reasons, the order's dataset travel quotes, the ferry terminals and city-to-terminal road estimates, and the budget.
  - **Output (JSON):** summary, hotel needed (and why), legs (kind train, ferry, hotel, drive, flight or local; from, to, when, rough EUR, note), total, within budget, caveats.
  - **Validation and caching:** the reply is validated. It is cached in `cr_travel_plans` (a cache table that reset keeps), keyed by prompt version, model and inputs.
  - **Fallback:** without a model, a template plan made by fixed rules.
- **Driver view.** `GET /api/phone/jobs` lists jobs live to drivers: on the market, filtered, and planned when demanding. The Driver phone lists them, each with a collapsed "Suggested travel plan".
- **Operator view.** The order page gets a collapsed "Travel plan" section at the bottom. The Solved review (rewrite, transcripts, Approve) sits in the order's work area.

## Testing Decisions

- Tests go through the engine seam (`state` / `apply`) on both stores, like the existing engine tests.
- Grouping: verdict tests for Solved and Finished precedence.
- Publishing:
  - a reviewed Normal unposted order is published by `runPublishing`;
  - an unreviewed one is not;
  - a Solved one waits;
  - `confirmChanges` publishes it;
  - a new call result brings it back to Solved.
- Filter: pure tests on named orders (CD-421053 cross-country, CD-420692 long drive, CD-420257 ferry, CD-420015 not demanding).
- Planner: template plan without a model; a scripted gateway reply is validated and cached; a bad reply falls back to the template.
- Real-model checks only on one or two named orders.

## Out of Scope

- Booking anything: hotels, tickets and ferries are suggestions only.
- Real driver budgets, and choosing or notifying a specific driver.
- Withdrawing a published offer.

## Further Notes

- At load, 8 of the 11 orders already Finding a driver are demanding. Among the 24 not on the market, 9 would be demanding once published.

## Implementation Notes

- **The planner's model** defaults to the reviewer's model (`TRAVEL_MODEL` overrides it), at low effort with room for 8000 tokens. A live check on CD-421053 drafted a two-day plan with a night near Stuttgart for about $0.002. At 2500 tokens the reply was cut off and fell back to the template.
- **The publishing loop** runs every 3 s (`PUBLISH_PUMP_MS`, 0 turns it off) and drafts at most one plan per tick.
- **The operator's publish and confirm** run the demand filter at once, so a job that is not demanding is live straight away.
- **An agent call result that a newer version replaced** (for example a handover the operator closed) is history, not a change to confirm.
