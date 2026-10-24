# The snapshot is never edited; changes are effect events on top

The control room never updates the seeded dataset rows. Every committed change to an order is an append-only effect event in our own tables, and the order view, rule checks and reviewer read the snapshot with those effect events applied. Our tables have no foreign keys into the starter's tables.

We chose this over updating rows in place because the dataset's own rule is that only a linked effect event is a committed change, because it keeps a full history of why an order changed, and because the starter's seed replaces its tables in one transaction and refuses to run if other tables hold foreign keys to them. Reseeding and the demo reset therefore never lose or corrupt our state. The cost is that every reader of an order must go through the overlay, never the raw rows.
