// The plain-words cache in the digest prose table (`cr_digest_prose`), under its own
// key prefix: engine reset keeps it (CACHE_TABLES), like the digest prose.

import { inArray } from "drizzle-orm"
import type { PlainCache, PlainText } from "./plain-words"
import type { Database } from "./postgres"
import { digestProse } from "./schema"

const PREFIX = "plain:"

export function createPostgresPlainCache(db: Database): PlainCache {
  return {
    async getMany(keys) {
      if (!keys.length) return new Map()
      const rows = await db.select().from(digestProse).where(inArray(digestProse.key, keys.map((key) => PREFIX + key)))
      return new Map(rows.map((row) => [row.key.slice(PREFIX.length), row.prose as unknown as PlainText]))
    },
    async put(key, text, model) {
      const values = { key: PREFIX + key, prose: { ...text, model } as unknown as Record<string, unknown>, createdAt: new Date() }
      await db.insert(digestProse).values(values).onConflictDoUpdate({ target: digestProse.key, set: { prose: values.prose, createdAt: values.createdAt } })
    },
  }
}
