# 01: Engine seam, store and test runner

**What to build:** A prefactor that gives every later ticket one place to work. The operations engine exposes `state(now)` and `apply(command)` over the snapshot, reading orders through the existing per-order bundles. It owns the demo clock (starting at 2026-10-21T09:00Z) and stores its own state in new tables that have no foreign keys into the starter's tables (ADR 0002). The engine runs against a Postgres store in the app and an in-memory store in tests. A lightweight TypeScript test runner is added to the project. Nothing visible changes in the UI yet.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The engine loads all 100 orders from the snapshot and reports the demo clock at 2026-10-21T09:00Z
- [x] The engine works the same against the Postgres store and the in-memory store
- [x] Our tables have no foreign keys into the starter's tables, and the starter's seed still runs after they exist
- [x] A reset empties our tables and leaves the snapshot untouched
- [x] One command runs the test suite; a first test (real dataset, in-memory store, clock fixed at the snapshot) checks that 100 orders load
- [x] Typecheck and build still pass
