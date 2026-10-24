// The OpenRouter speech adapter (ticket 10), through the `Speech` port with a fake
// fetch: no network. Expected values: OpenRouter's /audio/speech request shape and
// the default model's listed price ($0.62 per million characters).

import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { createDiskAudioStore, createMemoryAudioStore, mp3Seconds, openRouterSpeech } from "./speech"

// One MPEG-2 layer III frame header at 64 kbps (0xFF 0xF3 0x84 ...), padded to 16000 bytes: 2.0 s.
function fakeMp3(bytes = 16_000): Uint8Array {
  const out = new Uint8Array(bytes)
  out.set([0xff, 0xf3, 0x84, 0xc4])
  return out
}

function fakeFetch(status = 200) {
  const requests: { url: string; body: Record<string, unknown> }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    if (status !== 200) return new Response(JSON.stringify({ error: { message: "no such model" } }), { status })
    return new Response(Buffer.from(fakeMp3()), { status: 200, headers: { "content-type": "audio/mpeg" } })
  }) as typeof fetch
  return { fn, requests }
}

test("a prompt is generated once, priced per character, and served from the cache afterwards", async () => {
  const fetcher = fakeFetch()
  const speech = openRouterSpeech({ apiKey: "test", store: createMemoryAudioStore(), fetch: fetcher.fn })
  const text = "Are you still on track with this delivery?"
  const first = await speech.speak(text)
  assert.equal(fetcher.requests.length, 1)
  assert.equal(fetcher.requests[0].url, "https://openrouter.ai/api/v1/audio/speech")
  assert.equal(fetcher.requests[0].body.input, text)
  assert.equal(fetcher.requests[0].body.response_format, "mp3")
  assert.ok(first.audioId)
  assert.equal(first.cached, false)
  assert.equal(first.seconds, 2)
  assert.ok(Math.abs(first.cost - 0.00063) < 1e-12, "42 characters at $15 per million")

  const again = await speech.speak(text)
  assert.equal(fetcher.requests.length, 1, "no second request")
  assert.deepEqual({ ...again }, { ...first, cost: 0, cached: true })
})

test("a failed generation gives text without audio, at no cost, and does not throw", async () => {
  const speech = openRouterSpeech({ apiKey: "test", store: createMemoryAudioStore(), fetch: fakeFetch(400).fn })
  const spoken = await speech.speak("Hello there, this is a test prompt.")
  assert.equal(spoken.audioId, null)
  assert.equal(spoken.cost, 0)
  assert.ok(spoken.seconds > 0)
  assert.match(spoken.error ?? "", /400/)
})

test("a slow generation lets the prompt go out as text, and still fills the cache for next time", async () => {
  const fetcher = fakeFetch()
  const slow = (async (url: string | URL | Request, init?: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, 60))
    return fetcher.fn(url, init)
  }) as typeof fetch
  const speech = openRouterSpeech({ apiKey: "test", store: createMemoryAudioStore(), fetch: slow, waitMs: 10 })
  const first = await speech.speak("Thank you.")
  assert.equal(first.audioId, null)
  assert.match(first.error ?? "", /no audio within 10 ms/)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const later = await speech.speak("Thank you.")
  assert.ok(later.audioId)
  assert.equal(later.cached, true)
  assert.equal(fetcher.requests.length, 1)
})

test("the disk audio store keeps audio across processes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tts-"))
  try {
    const fetcher = fakeFetch()
    const first = await openRouterSpeech({ apiKey: "test", store: createDiskAudioStore(dir), fetch: fetcher.fn }).speak("Thank you.")
    const second = await openRouterSpeech({ apiKey: "test", store: createDiskAudioStore(dir), fetch: fetcher.fn }).speak("Thank you.")
    assert.equal(fetcher.requests.length, 1)
    assert.equal(second.audioId, first.audioId)
    assert.equal(second.cached, true)
    const stored = await createDiskAudioStore(dir).get(first.audioId!)
    assert.equal(stored?.bytes.length, 16_000)
    assert.equal(mp3Seconds(stored!.bytes), 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
