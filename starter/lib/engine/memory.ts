import type { StoredProposalEvent } from "./proposals"
import type { EngineStore } from "./store"

export function createMemoryStore(): EngineStore {
  let clock: string | null = null
  let proposalEvents: StoredProposalEvent[] = []
  return {
    async readClock() { return clock },
    async writeClock(now) { clock = now },
    async readProposalEvents() { return structuredClone(proposalEvents) },
    async appendProposalEvents(events) { proposalEvents = [...proposalEvents, ...structuredClone(events)] },
    async reset() { clock = null; proposalEvents = [] },
  }
}
