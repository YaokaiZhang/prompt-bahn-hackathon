// The app's engine: the seeded snapshot and the Postgres store. Routes and server
// components call `getEngine()`; nothing else in the app should read our tables.

import "server-only"
import { db } from "@/lib/db"
import { createEngine, type Engine } from "./engine"
import { createPostgresStore } from "./postgres"
import { snapshotFromDatabase } from "./snapshot"

// The snapshot is read once per server process (kept across dev reloads).
// Restart the server after reseeding.
const cache = globalThis as unknown as { controlRoomEngine?: Promise<Engine> }

export function getEngine(): Promise<Engine> {
  cache.controlRoomEngine ??= snapshotFromDatabase(db)
    .then((snapshot) => createEngine({ snapshot, store: createPostgresStore(db) }))
    .catch((error) => { cache.controlRoomEngine = undefined; throw error })
  return cache.controlRoomEngine
}
