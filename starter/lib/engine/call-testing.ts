// Test doubles for calls: a scripted person (re-exported) and speech without network.

import { estimateSeconds, type Speech } from "./speech"

export { scriptedPerson } from "./simulated-person"

export type ScriptedSpeech = Speech & { readonly spoken: string[] }

/**
 * Speech for tests: every new text "costs" $0.00001 per character and gets an id;
 * repeating a text is a cache hit (cost 0), like the real cache.
 */
export function scriptedSpeech(): ScriptedSpeech {
  const seen = new Map<string, string>()
  const spoken: string[] = []
  return {
    spoken,
    async speak(text) {
      spoken.push(text)
      const known = seen.get(text)
      if (known) return { audioId: known, seconds: estimateSeconds(text), cost: 0, cached: true, model: "scripted" }
      const id = `a${String(seen.size + 1).padStart(8, "0")}`
      seen.set(text, id)
      return { audioId: id, seconds: estimateSeconds(text), cost: text.length * 0.00001, cached: false, model: "scripted" }
    },
  }
}
