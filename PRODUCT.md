# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Operators**: Bahn operations staff who keep car deliveries on track. They work in long sessions on a laptop or external monitor in a daylight office. Their job is to see which orders need a person, understand why from the evidence, and decide or make the contact. The same screens are also shown on a projector at the Prompt Operations Hackathon demo (24–25 Oct 2026), so they have to read at room distance as well as at arm's length.

Teammates also play the **Site** and **Driver** personas (the mock phone page in the spec). A persona is a demo login role, not a party to the order.

## Product Purpose

The Car Delivery Control Room is where Bahn operators and agents work together to get every car delivered. Agents check orders, ask the cheap questions, and bring an operator only the decisions that need a person, with the evidence and a ready-to-approve next step. Success: an operator can tell at a glance which orders need them, trust that "normal" means checked, and act on a conflict without reading every record.

## Positioning

Cheap-first work by agents under an explicit approval policy. Rule checks and a reviewer agent read every order, so a quiet order is checked rather than unexamined. The agent never contacts the customer side; it proposes, and the operator decides. Every claim on screen links to the record it came from.

## Operating Context

- Orders move cars between dealers, sites, yards and private addresses across Europe (Finland, Sweden, Germany, Italy, France and others), by driver, train and ferry.
- One order's records often disagree: customer messages, site notes, endpoint claims, tracking, documents, expenses, alerts and work items.
- Vocabulary is fixed in `GLOSSARY.md` (Needs action, In progress, Normal, Done; proposal, approve, policy row, effect event, couldn't-check item, finding, call, tier, handover, digest). The UI uses these words.
- The snapshot time is 2026-10-21T09:00Z. Every time shown is relative to that, not the wall clock.

## Capabilities and Constraints

- Stack: the `starter/` app (Next.js, TypeScript, Postgres via Drizzle, a local S3-style object store for attachments). The data and read layer (`lib/present/*`, `app/api/*`) stays; the frontend is being rebuilt.
- Today the app is read-only: orders board, order record, support inbox, customers, drivers and places. The operations engine in `.scratch/control-room/spec.md` (four groups, proposals, calls, briefing, rules page, persona picker, phone page) is planned and not built yet. The current redesign covers the existing routes only.
- All data is fictional, and nothing real is connected. The snapshot is never edited (ADR 0002). The customer side is propose-only (ADR 0001).
- Car pictures in `starter/public/car-images` are model illustrations shared across orders, not photos of the car.

## Brand Commitments

- The product sits in Bahn's brand. The bahn.com page "Vehicle transport across Europe" is the binding visual reference for the UI. The user supplied it as a saved page with its assets.
- Bahn's brand faces (Owners Wide for display, Duplet Open for text) are licensed. Open fallbacks have to stand in for them.

## Evidence on Hand

- `dataset/`: 100 fictional orders with every related record (`dataset/SCHEMA.md`).
- `attachments/`: fictional documents, receipts and photos.
- `starter/public/car-images`, `starter/public/car-logos`: model illustrations and make logos.
- No real customers, testimonials, metrics or prices may be shown as real.

## Product Principles

1. Show only what needs a person; quiet orders stay quiet but provably checked.
2. Every fact shows its source, and proposal text is never shown as fact.
3. Use the domain's own words (GLOSSARY.md), not generic dashboard words.
4. Cheap work happens on its own; anything that changes an order or reaches the customer waits for a yes.
5. Calm and high-signal: built for operators, not engineers.

## Accessibility & Inclusion

Must read on a projector at the demo: high contrast and type large enough for room distance on the main screens. WCAG AA contrast for text.
