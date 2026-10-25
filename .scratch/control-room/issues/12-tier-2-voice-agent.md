# 12: Tier-2 voice agent

**What to build:** When keypad questions are not enough, the call moves to tier 2 on the phone page with push-to-talk. An audio-in, audio-out model (for example `openai/gpt-4o-audio-preview`, streamed) runs the conversation, with a short brief, not the full case file. After each turn Haiku checks the transcript against the evidence and policy and writes the structured result. The voice agent only gathers information and never commits to a change. If the audio model fails, the fallback is: a transcription model (`openai/whisper-large-v3`) listens, Haiku decides, and text-to-speech speaks. Each turn's cost is added to the call's meter.

**Blocked by:** 11 (Mock phone page, live tier 1).

**Status:** resolved

- [x] A call moves from tier 1 to tier 2 and the tier shows on the order
- [x] Push-to-talk works on the phone page, and the agent answers aloud
- [x] Each turn shows in the transcript with Haiku's structured result
- [x] The agent never agrees to a change; anything it learns becomes a proposal or a call result
- [x] When the audio model is unavailable, the fallback path completes the same call
- [x] The CD-420437 driver call ("can you still deliver?") runs at tier 2
- [x] Each turn's cost appears on the meter

## Comments

- Models: OpenRouter does not list `openai/gpt-4o-audio-preview`; the audio model is `openai/gpt-audio-mini` (streamed PCM16, wrapped as WAV), `TIER2_AUDIO_MODEL` overrides it and `off` forces the fallback. The ear is `openai/whisper-large-v3` on `/audio/transcriptions` (runs on both paths, for the transcript line). Haiku checks each turn with reasoning off (`effort: "none"`).
- Streaming is server-side: the reply is streamed from the model and played once complete (first audio ~1.2 s, whole reply ~2-3 s). A real turn takes about 4-10 s end to end (ear and audio model side by side, then the check, then TTS when the reply is replaced).
- CD-420437's trigger: a tight ETA (latest ETA 10 min or less before the promise end) gives the order a driver line with status `on_request`: the pump never rings it; the operator rings it live ("Ring Thomas Mellervik live"). CD-420710 (0 min) gets the same line.
- Tier 2 runs on simulated calls too, in text: a model (Haiku, job `call-callee`) plays the callee from the order's records, and the same voice agent takes the turns with no ear, no audio model and no speech (path `text`: Haiku checks each turn and writes every reply). The call ends resolved or as a handover through the same path as a live call. The callee's model cost stays off the call's meter (a real callee is a person); the opener and the checks go on it. A simulated person without a model (tests, no key) still hands an escalation over at once.
- The opener is no longer fixed text: Haiku (job `call-opener`, reasoning off) writes it from the brief, saying what the agent knows (order, keypad answers, why it escalated) and asking one specific question; a template per escalation stands in when that fails. Its speech is generated per call on live calls (the cache only helps an identical opener) and its cost goes on the meter.
- A closing reply (resolved or handover) never asks a question: Haiku sometimes left one before "Goodbye.", so it is dropped.
