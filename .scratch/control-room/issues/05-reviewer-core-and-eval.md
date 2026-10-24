# 05: Reviewer core and eval

**What to build:** The reviewer runs from the command line. A `ModelGateway` port talks to OpenRouter (`anthropic/claude-haiku-5.5`, medium effort) and reports the cost of each call. For one order the reviewer gets a cached system prompt (rules, policy, condensed schema) and a prepared case file as its first message: the order's records normalised and sorted oldest first, each with id, time, source and `stated_by`, plus local times, now, rule results, and any earlier findings, open questions, instructions and call results. It may use read-only tools (the driver's other duties, related orders, site profile, inbox threads, policy) at most 8 times and answers through `submit_findings`. The server checks that cited ids exist and quotes match, allows one repair attempt, then drops a finding that still fails. Results are cached by a hash of the case file.

An eval script runs the real model on CD-420516, CD-420437, CD-420089, CD-420399, CD-420458, CD-420656 and CD-420311, prints a score against the expected findings, and records the replies as fixtures. A scripted gateway replays those fixtures in tests.

**Blocked by:** 01 (Engine seam, store and test runner).

**Status:** ready-for-agent

- [ ] The reviewer runs for one order from the command line and prints its findings and cost
- [ ] Each finding cites the records that disagree and the record that names who to ask
- [ ] A finding with a missing id or a wrong quote gets one repair attempt and is dropped if it still fails
- [ ] The tool budget of 8 calls is enforced
- [ ] The same case file is answered from the cache with no model call
- [ ] The eval script scores the 7 cases and records fixtures
- [ ] Tests use the scripted gateway and never call the network
- [ ] With no API key, the reviewer reports "not reviewed yet" instead of failing
