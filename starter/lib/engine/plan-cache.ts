// The travel plan cache in our own `cr_travel_plans` table. Engine reset keeps it
// (CACHE_TABLES): a hit is keyed by the prompt version, the model and the whole plan input.

import { eq } from "drizzle-orm"
import type { Database } from "./postgres"
import { travelPlans } from "./schema"
import type { CachedPlan, PlanCache } from "./travel-planner"

export function createPostgresPlanCache(db: Database): PlanCache {
  return {
    async get(key) {
      const [row] = await db.select().from(travelPlans).where(eq(travelPlans.key, key)).limit(1)
      return row ? (row.plan as unknown as CachedPlan) : null
    },
    async put(key, plan) {
      const values = { key, plan: plan as unknown as Record<string, unknown>, createdAt: new Date() }
      await db.insert(travelPlans).values(values).onConflictDoUpdate({ target: travelPlans.key, set: { plan: values.plan, createdAt: values.createdAt } })
    },
  }
}
