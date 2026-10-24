// The review cache in our own `cr_review_results` table. Engine reset truncates it
// with the other engine tables.

import { eq } from "drizzle-orm"
import type { Database } from "@/lib/engine/postgres"
import { reviewResults } from "@/lib/engine/schema"
import type { ReviewCache } from "./cache"
import type { Reviewed } from "./reviewer"

/** Needs `cr_review_results`: run `npx drizzle-kit push` after pulling this ticket. */
export function createPostgresReviewCache(db: Database): ReviewCache {
  return {
    async get(key) {
      const [row] = await db.select().from(reviewResults).where(eq(reviewResults.key, key)).limit(1)
      return row ? (row.result as unknown as Reviewed) : null
    },
    async put(key, result) {
      const values = { key, orderId: result.orderId, caseHash: result.hash, result: result as unknown as Record<string, unknown>, createdAt: new Date() }
      await db.insert(reviewResults).values(values).onConflictDoUpdate({ target: reviewResults.key, set: { result: values.result, createdAt: values.createdAt, caseHash: values.caseHash } })
    },
  }
}
