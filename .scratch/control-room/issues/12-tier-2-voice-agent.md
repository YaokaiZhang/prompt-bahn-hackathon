# 12: Tier-2 voice agent

**What to build:** When keypad questions are not enough, the call moves to tier 2 on the phone page with push-to-talk. An audio-in, audio-out model (for example `openai/gpt-4o-audio-preview`, streamed) runs the conversation, with a short brief, not the full case file. After each turn Haiku checks the transcript against the evidence and policy and writes the structured result. The voice agent only gathers information and never commits to a change. If the audio model fails, the fallback is: a transcription model (`openai/whisper-large-v3`) listens, Haiku decides, and text-to-speech speaks. Each turn's cost is added to the call's meter.

**Blocked by:** 11 (Mock phone page, live tier 1).

**Status:** ready-for-agent

- [ ] A call moves from tier 1 to tier 2 and the tier shows on the order
- [ ] Push-to-talk works on the phone page, and the agent answers aloud
- [ ] Each turn shows in the transcript with Haiku's structured result
- [ ] The agent never agrees to a change; anything it learns becomes a proposal or a call result
- [ ] When the audio model is unavailable, the fallback path completes the same call
- [ ] The CD-420437 driver call ("can you still deliver?") runs at tier 2
- [ ] Each turn's cost appears on the meter
