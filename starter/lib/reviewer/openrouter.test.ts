import assert from "node:assert/strict"
import { test } from "node:test"
import { GatewayError } from "./gateway"
import { createOpenRouterGateway, openRouterFromEnv } from "./openrouter"

type Sent = { url: string; init: RequestInit }

function fakeFetch(status: number, body: unknown, sent: Sent[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

const REPLY = {
  id: "gen-1",
  model: "provider/model-a",
  choices: [{
    finish_reason: "tool_calls",
    message: {
      role: "assistant", content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "submit_findings", arguments: "{\"findings\":[]}" } }],
      reasoning_details: [{ type: "reasoning.text", text: "thinking" }],
    },
  }],
  usage: {
    prompt_tokens: 12000, completion_tokens: 300, total_tokens: 12300, cost: 0.0042,
    prompt_tokens_details: { cached_tokens: 5000, cache_write_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 120 },
  },
}

test("a chat request maps onto OpenRouter's chat completions with effort, tools, cache control and usage accounting", async () => {
  const sent: Sent[] = []
  const gateway = createOpenRouterGateway({ apiKey: "test-key", fetch: fakeFetch(200, REPLY, sent) })
  const response = await gateway.chat({
    job: "reviewer", subject: "CD-420516", model: "provider/model-a", effort: "medium", maxTokens: 4000,
    messages: [
      { role: "system", content: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }] },
      { role: "user", content: "case file" },
    ],
    tools: [{ type: "function", function: { name: "submit_findings", description: "d", parameters: { type: "object" } } }],
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, "https://openrouter.ai/api/v1/chat/completions")
  assert.equal(new Headers(sent[0].init.headers).get("authorization"), "Bearer test-key")
  const body = JSON.parse(String(sent[0].init.body))
  assert.equal(body.model, "provider/model-a")
  assert.deepEqual(body.reasoning, { effort: "medium" })
  assert.deepEqual(body.usage, { include: true })
  assert.equal(body.max_tokens, 4000)
  assert.equal(body.messages[0].content[0].cache_control.type, "ephemeral")
  assert.equal(body.tools[0].function.name, "submit_findings")
  assert.equal(body.job, undefined, "job and subject stay local")
  assert.equal(body.subject, undefined)

  assert.equal(response.model, "provider/model-a")
  assert.equal(response.finishReason, "tool_calls")
  assert.equal(response.message.tool_calls?.[0].function.name, "submit_findings")
  assert.deepEqual(response.message.reasoning_details, [{ type: "reasoning.text", text: "thinking" }])
  assert.deepEqual(response.usage, { promptTokens: 12000, completionTokens: 300, cachedTokens: 5000, cacheWriteTokens: 0, reasoningTokens: 120, cost: 0.0042 })
})

test("an error status becomes a GatewayError with the provider's message", async () => {
  const gateway = createOpenRouterGateway({ apiKey: "k", fetch: fakeFetch(402, { error: { message: "Insufficient credits" } }, []) })
  await assert.rejects(
    gateway.chat({ job: "reviewer", subject: "x", model: "m", messages: [{ role: "user", content: "hi" }] }),
    (error: unknown) => error instanceof GatewayError && error.status === 402 && /Insufficient credits/.test(error.message),
  )
})

test("an error inside a 200 reply is also a GatewayError", async () => {
  const gateway = createOpenRouterGateway({ apiKey: "k", fetch: fakeFetch(200, { error: { message: "Provider returned error", code: 502 } }, []) })
  await assert.rejects(gateway.chat({ job: "reviewer", subject: "x", model: "m", messages: [{ role: "user", content: "hi" }] }), GatewayError)
})

test("without OPENROUTER_API_KEY there is no gateway", () => {
  assert.equal(openRouterFromEnv({}), null)
  assert.equal(openRouterFromEnv({ OPENROUTER_API_KEY: "   " }), null)
  assert.ok(openRouterFromEnv({ OPENROUTER_API_KEY: "k" }))
})
