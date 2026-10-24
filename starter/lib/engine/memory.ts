import type { BriefingItem } from "./briefing"
import type { StoredCallEvent } from "./calls"
import type { StoredProposalEvent } from "./proposals"
import type { EngineStore } from "./store"

export function createMemoryStore(): EngineStore {
  let clock: string | null = null
  let briefing = new Map<string, BriefingItem>()
  let proposalEvents: StoredProposalEvent[] = []
  let callEvents: StoredCallEvent[] = []
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
    async readCallEvents() { return structuredClone(callEvents) },
    async appendCallEvents(events) {
      const taken = new Set(callEvents.map((event) => `${event.callId}#${event.seq}`))
      const keys = events.map((event) => `${event.callId}#${event.seq}`)
      if (keys.some((key) => taken.has(key)) || new Set(keys).size !== keys.length) return false
      callEvents = [...callEvents, ...structuredClone(events)]
      return true
    },
    async reset() { clock = null; briefing = new Map(); proposalEvents = []; callEvents = [] },
  }
}
