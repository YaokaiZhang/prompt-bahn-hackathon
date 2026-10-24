---
version: 1
slug: "starter-app-page-tsx"
primary_target: "starter/app/page.tsx"
related_targets: ["starter/app/orders","starter/app/inbox","starter/app/components"]
---

# Orders home and the control room shell

Mode: Operate. Scope: the Orders home (`/`), and the shell every existing route shares (order record, support inbox, customers, drivers, places).

Audience and job: Bahn operators in long daylight sessions on a laptop, and the same screens on a projector at the demo. Job: see which orders need a person, understand why from the evidence, open the order. Constraints: read-only data today. The spec engine (four groups, proposals, calls) is not built, so the queue ranks by the starter attention derivation and decisive date. No invented claims.

## Direction contract

THESIS: The home is a queue of what needs a person, with the selected order opened beside it, not a seven-lane kanban of everything. Quiet orders stay reachable through the stage filter but never compete for attention.

OWN-WORLD: Bahn: birch ground #fffef7, asphalt ink #12110e, sand panels #f1eee6 and #e2ded4, and 999px pill controls (asphalt primary, sand tertiary). Large 24px-radius panels. Wide heavy uppercase display (Archivo at 125% width, 900 weight) for page titles and the car name only. Figtree for everything else, with tabular figures. Orange #fd6a31 marks pickup, red #fd4a61 marks delivery and critical. Teal marks live work, green marks delivered.

STORY: The operator lands, reads "NEEDS A PERSON" with the count, takes the top order, sees its one-line reason, route and open items, and opens it or moves to the next.

FIRST VIEWPORT: A 72px top bar: bahn mark and "Control Room", pill nav in a sand track, snapshot clock on the right. Left column, about 440px: the display title, stage pills as filters with counts, then the scrolling queue of rounded sand cards, the selected one inverted to asphalt. Right: a large sand panel with the car illustration, the reference and stage pill, the car name in wide caps, the story headline, a pickup-to-delivery route with orange and red pins, the open items list, and "Open order" as an asphalt pill.

FORM: Queue and preview, position 1 on the ordered list (dealt card). seed:a1ab1911af84522c

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
