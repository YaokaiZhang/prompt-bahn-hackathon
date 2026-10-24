// The review cache port: reviewer results keyed by the case file's hash (plus the
// prompt version and model), so an unchanged order is answered with no model call.
// The app stores them in Postgres (`postgres-cache.ts`); tests use memory.

import type { Reviewed } from "./reviewer"

export interface ReviewCache {
  get(key: string): Promise<Reviewed | null>
  put(key: string, result: Reviewed): Promise<void>
}

export function createMemoryReviewCache(): ReviewCache {
  const entries = new Map<string, Reviewed>()
  return {
    async get(key) { return entries.has(key) ? structuredClone(entries.get(key)!) : null },
    async put(key, result) { entries.set(key, structuredClone(result)) },
  }
}
