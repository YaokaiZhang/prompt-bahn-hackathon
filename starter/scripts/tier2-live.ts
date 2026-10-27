// A real-model run of CD-420437's tier-2 driver call (ticket 12), in memory, without
// the app: ring live, keypad 1 then 2, then spoken turns from WAV files.
//   NODE_USE_ENV_PROXY=1 npx tsx scripts/tier2-live.ts <turn1.wav> [<turn2.wav> ...] [--fallback]
// --fallback switches the audio model off (ear, Haiku, text to speech). Keep runs small.

import "dotenv/config"
import { readFileSync } from "node:fs"
import path from "node:path"
import { anthropicFromEnv } from "@/lib/reviewer/anthropic"
import { createDiskAudioStore } from "@/lib/engine/speech"
import { createVoiceAgent } from "@/lib/engine/voice-agent"
import { speechFromEnv, transcriberFromEnv } from "@/lib/engine/voice-azure"
import { openRouterVoiceFromEnv } from "@/lib/engine/voice-openrouter"
import { demoAnswerer } from "@/lib/engine/phone"
import { scriptedPerson } from "@/lib/engine/simulated-person"
import { testEngine } from "@/lib/engine/testing"

async function main() {
  const args = process.argv.slice(2)
  const fallback = args.includes("--fallback")
  const files = args.filter((arg) => !arg.startsWith("--"))
  const gateway = anthropicFromEnv()
  const ear = transcriberFromEnv()
  if (!gateway || !ear) throw new Error("Set ANTHROPIC_API_KEY (Haiku) and AZURE_SPEECH_KEY with AZURE_SPEECH_REGION (or OPENROUTER_API_KEY) for speech")
  const store = createDiskAudioStore(process.env.AUDIO_CACHE_DIR || path.join(process.cwd(), ".cache", "tts"))
  const engine = await testEngine({
    calls: {
      person: scriptedPerson({}), speech: speechFromEnv(store), answererFor: demoAnswerer({ "CD-420437": ["driver"] }),
      voice: createVoiceAgent({ voice: fallback ? null : openRouterVoiceFromEnv(store), ear, checker: gateway }),
    },
  })
  const orderId = (await engine.state()).orders.find((row) => row.reference === "CD-420437")!.id
  await engine.apply({ type: "startCall", orderId, line: "driver", live: true })
  const id = (await engine.phone("driver")).current!.id
  for (const input of [{ type: "answer" }, { type: "key", digit: "1" }, { type: "key", digit: "2" }] as const) await engine.apply({ type: "callEvent", callId: id, input })
  let before = (await engine.phone("driver")).current!.cost.modelUsd
  for (const file of files) {
    const started = Date.now()
    await engine.apply({ type: "voiceTurn", callId: id, audio: { data: readFileSync(file).toString("base64"), format: "wav" } })
    const call = (await engine.state()).orders.find((row) => row.id === orderId)!.calls.at(-1)!
    console.log(`turn ${path.basename(file)}: ${Date.now() - started} ms, model $${(call.cost.modelUsd - before).toFixed(6)}`)
    before = call.cost.modelUsd
    if (call.state === "ended") break
  }
  const order = (await engine.state()).orders.find((row) => row.id === orderId)!
  const call = order.calls.at(-1)!
  for (const line of call.transcript) {
    console.log(`[${line.by}${line.tier > 1 ? " t2" : ""}${line.path ? ` ${line.path}` : ""}${line.cost ? ` $${line.cost.toFixed(6)}` : ""}] ${line.text}`)
    if (line.check) console.log("   check:", JSON.stringify(line.check))
  }
  console.log({ outcome: call.outcome, summary: call.summary, claims: call.claims, changes: call.changes, handover: call.handover, cost: call.cost })
  console.log("group:", order.group, "|", order.reason)
  console.log("proposals:", order.proposals.filter((row) => row.kind === "change").map((row) => [row.status, row.change]))
}

main().catch((error) => { console.error(error); process.exit(1) })
