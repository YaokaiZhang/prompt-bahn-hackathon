// The inbox agent's suggestion cache in our own `cr_inbox_suggestions` table. Engine reset
// keeps it (CACHE_TABLES): a hit is keyed by the prompt version, the model and the whole input.

import { eq } from "drizzle-orm"
import type { CachedSuggestion, SuggestionCache } from "./inbox-agent"
import type { Database } from "./postgres"
import { inboxSuggestions } from "./schema"

export function createPostgresSuggestionCache(db: Database): SuggestionCache {
  return {
    async get(key) {
      const [row] = await db.select().from(inboxSuggestions).where(eq(inboxSuggestions.key, key)).limit(1)
      return row ? (row.suggestion as unknown as CachedSuggestion) : null
    },
    async put(key, suggestion) {
      const values = { key, suggestion: suggestion as unknown as Record<string, unknown>, createdAt: new Date() }
      await db.insert(inboxSuggestions).values(values).onConflictDoUpdate({ target: inboxSuggestions.key, set: { suggestion: values.suggestion, createdAt: values.createdAt } })
    },
  }
}
