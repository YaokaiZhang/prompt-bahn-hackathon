import type { BriefingItem } from "./briefing"
import type { EffectEvent } from "./effects"
import type { StoredCallEvent } from "./calls"
import type { InboxEvent } from "./inbox"
import type { Mistake } from "./mistakes"
import type { StoredProposalEvent } from "./proposals"
import type { StoredPublicationEvent } from "./publishing"
import type { EngineStore } from "./store"

export function createMemoryStore(): EngineStore {
  let clock: string | null = null
  let briefing = new Map<string, BriefingItem>()
  let proposalEvents: StoredProposalEvent[] = []
  let effects: EffectEvent[] = []
  let callEvents: StoredCallEvent[] = []
  let publicationEvents: StoredPublicationEvent[] = []
  let inboxEvents: InboxEvent[] = []
  // Kept across reset, like LEARNING_TABLES.
  let mistakes: Mistake[] = []
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
    async readEffects() { return structuredClone(effects) },
    async appendEffects(events) { effects = [...effects, ...structuredClone(events)] },
    async readCallEvents() { return structuredClone(callEvents) },
    async appendCallEvents(events) {
      const taken = new Set(callEvents.map((event) => `${event.callId}#${event.seq}`))
      const keys = events.map((event) => `${event.callId}#${event.seq}`)
      if (keys.some((key) => taken.has(key)) || new Set(keys).size !== keys.length) return false
      callEvents = [...callEvents, ...structuredClone(events)]
      return true
    },
    async readPublicationEvents() { return structuredClone(publicationEvents) },
    async appendPublicationEvents(events) { publicationEvents = [...publicationEvents, ...structuredClone(events)] },
    async readInboxEvents() { return structuredClone(inboxEvents) },
    async appendInboxEvents(events) { inboxEvents = [...inboxEvents, ...structuredClone(events)] },
    async reset() { clock = null; briefing = new Map(); proposalEvents = []; effects = []; callEvents = []; publicationEvents = []; inboxEvents = [] },
    async readMistakes() { return structuredClone(mistakes) },
    async appendMistakes(added) {
      const taken = new Set(mistakes.map((mistake) => mistake.id))
      for (const mistake of added) {
        if (taken.has(mistake.id)) continue
        taken.add(mistake.id)
        mistakes = [...mistakes, structuredClone(mistake)]
      }
    },
    async settleMistake(id, restated) {
      mistakes = mistakes.map((mistake) => mistake.id === id && mistake.status === "pending" ? { ...mistake, ...structuredClone(restated) } : mistake)
    },
  }
}
