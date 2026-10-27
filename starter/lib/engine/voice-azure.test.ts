// The Azure AI Speech adapters with a fake fetch: no network. Expected values: the
// REST shapes Azure answered with live (October 2026) and its list prices.

import assert from "node:assert/strict"
import { test } from "node:test"
import { createMemoryAudioStore } from "./speech"
import { azureFromEnv, azureSpeech, azureTranscriber, speechFromEnv, transcriberFromEnv } from "./voice-azure"
import { pcm16ToWav } from "./voice-audio"

type Seen = { url: string; headers: Record<string, string>; body: string | Uint8Array }

function fakeFetch(reply: () => Response) {
  const requests: Seen[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: init?.headers as Record<string, string>, body: init?.body as string | Uint8Array })
    return reply()
  }) as typeof fetch
  return { fn, requests }
}

// One MPEG-2 layer III frame header at 64 kbps, padded to 16000 bytes: 2.0 s.
function fakeMp3(): Uint8Array {
  const out = new Uint8Array(16_000)
  out.set([0xff, 0xf3, 0x84, 0xc4])
  return out
}

test("text to speech sends escaped SSML for the voice, prices per character and caches", async () => {
  const fetcher = fakeFetch(() => new Response(Buffer.from(fakeMp3()), { status: 200 }))
  const speech = azureSpeech({ key: "k", region: "germanywestcentral", store: createMemoryAudioStore(), fetch: fetcher.fn })
  const text = "Arrive at 16:30 & call <us>?"
  const first = await speech.speak(text)
  assert.equal(fetcher.requests[0].url, "https://germanywestcentral.tts.speech.microsoft.com/cognitiveservices/v1")
  assert.equal(fetcher.requests[0].headers["Ocp-Apim-Subscription-Key"], "k")
  assert.equal(fetcher.requests[0].headers["X-Microsoft-OutputFormat"], "audio-24khz-48kbitrate-mono-mp3")
  assert.equal(fetcher.requests[0].body, `<speak version="1.0" xml:lang="en-US"><voice name="en-US-AvaMultilingualNeural">Arrive at 16:30 &amp; call &lt;us&gt;?</voice></speak>`)
  assert.equal(first.seconds, 2)
  assert.equal(first.model, "azure/en-US-AvaMultilingualNeural")
  assert.ok(Math.abs(first.cost - text.length * 16e-6) < 1e-12)
  const again = await speech.speak(text)
  assert.equal(fetcher.requests.length, 1)
  assert.equal(again.cached, true)
})

test("a failed generation gives text without audio", async () => {
  const speech = azureSpeech({ key: "k", region: "x", store: createMemoryAudioStore(), fetch: fakeFetch(() => new Response("", { status: 401, statusText: "Unauthorized" })).fn })
  const spoken = await speech.speak("Hello there.")
  assert.equal(spoken.audioId, null)
  assert.match(spoken.error ?? "", /401/)
})

test("the ear posts the WAV at its own rate and prices the clip by its length", async () => {
  const fetcher = fakeFetch(() => Response.json({ RecognitionStatus: "Success", DisplayText: "About 4:30.  There is a closure.", Duration: 25_000_000 }))
  const wav = Buffer.from(pcm16ToWav(new Uint8Array(16_000 * 2 * 3), 16_000)).toString("base64")
  const heard = await azureTranscriber({ key: "k", region: "germanywestcentral", fetch: fetcher.fn }).transcribe({ data: wav, format: "wav" }, "CD-1")
  assert.equal(fetcher.requests[0].url, "https://germanywestcentral.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=simple")
  assert.equal(fetcher.requests[0].headers["Content-Type"], "audio/wav; codecs=audio/pcm; samplerate=16000")
  assert.deepEqual({ ...heard, cost: undefined }, { text: "About 4:30. There is a closure.", seconds: 3, cost: undefined, model: "azure/stt-en-US" })
  assert.ok(Math.abs(heard.cost - 3 / 3600) < 1e-12, "3 s at $1 per hour")
})

test("silence is an empty turn; a recognizer error throws", async () => {
  const wav = Buffer.from(pcm16ToWav(new Uint8Array(3200), 16_000)).toString("base64")
  const silent = azureTranscriber({ key: "k", region: "r", fetch: fakeFetch(() => Response.json({ RecognitionStatus: "InitialSilenceTimeout" })).fn })
  assert.equal((await silent.transcribe({ data: wav, format: "wav" }, "CD-1")).text, "")
  const broken = azureTranscriber({ key: "k", region: "r", fetch: fakeFetch(() => Response.json({ RecognitionStatus: "Error" })).fn })
  await assert.rejects(broken.transcribe({ data: wav, format: "wav" }, "CD-1"), /Error/)
  await assert.rejects(broken.transcribe({ data: wav, format: "mp3" }, "CD-1"), /WAV or OGG/)
})

test("the environment picks Azure when it has a key and a region", () => {
  assert.equal(azureFromEnv({ AZURE_SPEECH_KEY: "k" }), null)
  assert.deepEqual(azureFromEnv({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "westeurope" }), { key: "k", region: "westeurope" })
  assert.deepEqual(azureFromEnv({ AZURE_SPEECH_KEY: "k", AZURE_SPEECH_ENDPOINT: "https://germanywestcentral.api.cognitive.microsoft.com/" }), { key: "k", region: "germanywestcentral" })
  const env = { AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "r" }
  assert.ok(speechFromEnv(createMemoryAudioStore(), env))
  assert.ok(transcriberFromEnv(env))
  assert.equal(transcriberFromEnv({}), null)
})
