// The digest prose cache in our own `cr_digest_prose` table. Engine reset keeps it
// (CACHE_TABLES): a hit is keyed by the prompt version, the model and the whole facts.

import { eq } from "drizzle-orm"
import type { CachedProse, ProseCache } from "./digest-prose"
import type { Database } from "./postgres"
import { digestProse } from "./schema"

export function createPostgresProseCache(db: Database): ProseCache {
  return {
    async get(key) {
      const [row] = await db.select().from(digestProse).where(eq(digestProse.key, key)).limit(1)
      return row ? (row.prose as unknown as CachedProse) : null
    },
    async put(key, prose) {
      const values = { key, prose: prose as unknown as Record<string, unknown>, createdAt: new Date() }
      await db.insert(digestProse).values(values).onConflictDoUpdate({ target: digestProse.key, set: { prose: values.prose, createdAt: values.createdAt } })
    },
  }
}
