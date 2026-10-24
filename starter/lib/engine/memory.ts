import type { EngineStore } from "./store"

export function createMemoryStore(): EngineStore {
  let clock: string | null = null
  return {
    async readClock() { return clock },
    async writeClock(now) { clock = now },
    async reset() { clock = null },
  }
}
