import assert from "node:assert/strict"
import { test } from "node:test"
import { GatewayError } from "./gateway"
import { anthropicFromEnv, costOf, createAnthropicGateway } from "./anthropic"

type Sent = { url: string; init: RequestInit }

function fakeFetch(status: number, body: unknown, sent: Sent[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}

const THINKING = { type: "thinking", thinking: "", signature: "sig" }

const REPLY = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  stop_reason: "tool_use",
  stop_sequence: null,
  content: [
    THINKING,
    { type: "text", text: "Checking." },
    { type: "tool_use", id: "toolu_1", name: "submit_findings", input: { findings: [] } },
  ],
  usage: { input_tokens: 7000, output_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
}

test("a chat request maps onto the Messages API with effort, tools, cache control and usage accounting", async () => {
  const sent: Sent[] = []
  const gateway = createAnthropicGateway({ apiKey: "test-key", fetch: fakeFetch(200, REPLY, sent) })
  const response = await gateway.chat({
    job: "reviewer", subject: "CD-420516", model: "claude-haiku-5-5", effort: "medium", maxTokens: 4000,
    messages: [
      { role: "system", content: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }] },
      { role: "user", content: "case file" },
    ],
    tools: [{ type: "function", function: { name: "submit_findings", description: "d", parameters: { type: "object" } } }],
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, "https://api.anthropic.com/v1/messages")
  assert.equal(new Headers(sent[0].init.headers).get("authorization"), "Bearer test-key")
  const body = JSON.parse(String(sent[0].init.body))
  assert.equal(body.model, "claude-haiku-5-5")
  assert.deepEqual(body.output_config, { effort: "medium" })
  assert.equal(body.thinking, undefined)
  assert.equal(body.max_tokens, 4000)
  assert.deepEqual(body.system, [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }])
  assert.deepEqual(body.messages, [{ role: "user", content: [{ type: "text", text: "case file" }] }])
  assert.deepEqual(body.tools, [{ name: "submit_findings", description: "d", input_schema: { type: "object" } }])
  assert.equal(body.job, undefined, "job and subject stay local")
  assert.equal(body.subject, undefined)

  assert.equal(response.model, "claude-haiku-5-5")
  assert.equal(response.finishReason, "tool_calls")
  assert.equal(response.message.content, "Checking.")
  assert.deepEqual(response.message.tool_calls, [{ id: "toolu_1", type: "function", function: { name: "submit_findings", arguments: "{\"findings\":[]}" } }])
  assert.deepEqual(response.message.reasoning_details, [THINKING])
  const cost = (7000 * 0.1 + 5000 * 0.1 * 0.1 + 300 * 0.5) / 1_000_000
  assert.deepEqual(response.usage, { promptTokens: 12000, completionTokens: 300, cachedTokens: 5000, cacheWriteTokens: 0, reasoningTokens: 0, cost })
})

test("a tool loop goes back as tool_use and tool_result blocks, thinking first, results in one user message", async () => {
  const sent: Sent[] = []
  const gateway = createAnthropicGateway({ apiKey: "k", fetch: fakeFetch(200, { ...REPLY, stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }, sent) })
  const response = await gateway.chat({
    job: "reviewer", subject: "x", model: "claude-haiku-5-5", effort: "none",
    messages: [
      { role: "user", content: "case file" },
      {
        role: "assistant", content: null, reasoning_details: [THINKING, { type: "reasoning.text", text: "recorded elsewhere" }],
        tool_calls: [
          { id: "toolu_a", type: "function", function: { name: "read", arguments: "{\"id\":1}" } },
          { id: "toolu_b", type: "function", function: { name: "read", arguments: "{\"id\":2}" } },
        ],
      },
      { role: "tool", tool_call_id: "toolu_a", content: "one" },
      { role: "tool", tool_call_id: "toolu_b", content: "two" },
    ],
  })
  const body = JSON.parse(String(sent[0].init.body))
  assert.deepEqual(body.thinking, { type: "disabled" })
  assert.equal(body.output_config, undefined)
  assert.equal(body.max_tokens, 16000)
  assert.equal(body.system, undefined)
  assert.deepEqual(body.messages.slice(1), [
    { role: "assistant", content: [THINKING, { type: "tool_use", id: "toolu_a", name: "read", input: { id: 1 } }, { type: "tool_use", id: "toolu_b", name: "read", input: { id: 2 } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_a", content: "one" }, { type: "tool_result", tool_use_id: "toolu_b", content: "two" }] },
  ])
  assert.equal(response.finishReason, "stop")
  assert.equal(response.message.content, "done")
  assert.equal(response.message.tool_calls, undefined)
})

test("an error status becomes a GatewayError with the provider's message", async () => {
  const gateway = createAnthropicGateway({ apiKey: "k", fetch: fakeFetch(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } }, []) })
  await assert.rejects(
    gateway.chat({ job: "reviewer", subject: "x", model: "m", messages: [{ role: "user", content: "hi" }] }),
    (error: unknown) => error instanceof GatewayError && error.status === 400 && /credit balance/.test(error.message),
  )
})

test("long Haiku 5.5 prompts are billed at the long-context price; unknown models cost 0", () => {
  assert.equal(costOf("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 1000 } as never), (200_000 * 0.5 + 1000 * 2.5) / 1_000_000)
  assert.equal(costOf("some-other-model", { input_tokens: 1000, output_tokens: 1000 } as never), 0)
})

test("without ANTHROPIC_API_KEY there is no gateway", () => {
  assert.equal(anthropicFromEnv({}), null)
  assert.equal(anthropicFromEnv({ ANTHROPIC_API_KEY: "   " }), null)
  assert.ok(anthropicFromEnv({ ANTHROPIC_API_KEY: "k" }))
})
