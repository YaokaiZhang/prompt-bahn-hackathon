import type { BriefingItem } from "./briefing"
import type { StoredProposalEvent } from "./proposals"
import type { EngineStore } from "./store"

export function createMemoryStore(): EngineStore {
  let clock: string | null = null
  let briefing = new Map<string, BriefingItem>()
  let proposalEvents: StoredProposalEvent[] = []
  return {
    async readClock() { return clock },
    async writeClock(now) { clock = now },
    async readBriefing() { return [...briefing.values()].map((item) => structuredClone(item)) },
    async addBriefing(item) {
      if (briefing.has(item.id)) return false
      briefing.set(item.id, structuredClone(item))
      return true
    },
    async markBriefingRead(ids) {
      for (const item of briefing.values()) if (!ids || ids.includes(item.id)) item.read = true
    },
    async readProposalEvents() { return structuredClone(proposalEvents) },
    async appendProposalEvents(events) { proposalEvents = [...proposalEvents, ...structuredClone(events)] },
    async reset() { clock = null; briefing = new Map(); proposalEvents = [] },
  }
}
