# 05: Reviewer core and eval

**What to build:** The reviewer runs from the command line. A `ModelGateway` port talks to OpenRouter (`anthropic/claude-haiku-5.5`, medium effort) and reports the cost of each call. For one order the reviewer gets a cached system prompt (rules, policy, condensed schema) and a prepared case file as its first message: the order's records normalised and sorted oldest first, each with id, time, source and `stated_by`, plus local times, now, rule results, and any earlier findings, open questions, instructions and call results. It may use read-only tools (the driver's other duties, related orders, site profile, inbox threads, policy) at most 8 times and answers through `submit_findings`. The server checks that cited ids exist and quotes match, allows one repair attempt, then drops a finding that still fails. Results are cached by a hash of the case file.

An eval script runs the real model on CD-420516, CD-420437, CD-420089, CD-420399, CD-420458, CD-420656 and CD-420311, prints a score against the expected findings, and records the replies as fixtures. A scripted gateway replays those fixtures in tests.

**Blocked by:** 01 (Engine seam, store and test runner).

**Status:** resolved

- [x] The reviewer runs for one order from the command line and prints its findings and cost
- [x] Each finding cites the records that disagree and the record that names who to ask
- [x] A finding with a missing id or a wrong quote gets one repair attempt and is dropped if it still fails
- [x] The tool budget of 8 calls is enforced
- [x] The same case file is answered from the cache with no model call
- [x] The eval script scores the 7 cases and records fixtures
- [x] Tests use the scripted gateway and never call the network
- [x] With no API key, the reviewer reports "not reviewed yet" instead of failing

## Comments

- **(Superseded, see the tuning note below.) Eval not run against the real model.** `openrouter.ai` is denied by this container's egress proxy (CONNECT 403), so `npm run review:eval` and `npm run review -- <ref>` could not reach the model even with `OPENROUTER_API_KEY` set; they report "not reviewed yet: the model call failed". The eval script is complete: with network access it scores the 7 cases, prints the cost and overwrites `starter/lib/reviewer/fixtures/cases/*.json` with recorded replies. Until then those fixtures are hand-written from PRD §6.5 (`"origin": "hand-written"`) and `npm run review:eval -- --replay` scores them offline (19/19). The model id `anthropic/claude-haiku-5.5` could not be checked against OpenRouter's model list for the same reason.
- The OpenRouter adapter follows the documented OpenAI-compatible chat-completions shape (tools, `reasoning.effort`, `cache_control` on the system part, `usage.cost`); OpenRouter's docs were not reachable either, so it is verified only against a fake fetch.
- **Real eval (branch t05b-reviewer-tuning).** First real run: 8/19 for $0.031. After tuning the prompt and the submission parsing: **19/19 for $0.028** (recorded run, `lib/reviewer/fixtures/cases/*.json` are now `"origin": "recorded"`, score in `lib/reviewer/fixtures/last-run.json`). Per case: CD-420516 3/3, CD-420437 3/3, CD-420089 3/3, CD-420399 3/3, CD-420458 1/1, CD-420656 3/3, CD-420311 3/3. Two further unrecorded (`--dry`) runs scored 19/19 ($0.028) and 17/19 ($0.029; CD-420089 asked the driver instead of the note's author). Each full run costs about $0.03.
- Changes: findings sent as a JSON-encoded string (also with stray closing brackets) are read as the list; a submission in the wrong format gets its own retry and keeps the evidence repair; a quote copied as `"key":"value"` matches that field; repair feedback shows the named field's real value; the submit_findings schema forbids extra properties. Prompt `reviewer-v2`: a precise "already asked" test (a Bahn message put the question to the person who can settle it, no reply since, check-back still ahead), so open alerts, work items or call logs no longer suppress a conflict; checks for positioning that skips a live duty, pickup/handover facts and who may sign; cite every record on both sides; a bare UNCONFIRMED status or an oddity inside one record is not a conflict; no side questions while the blocking question is already asked.
