// The Anthropic adapter of the ModelGateway port: the gateway's chat-completions
// shape mapped onto the Messages API (@anthropic-ai/sdk). System parts keep their
// `cache_control`, tool calls become `tool_use` / `tool_result` blocks, thinking
// blocks ride in `reasoning_details` so a tool loop passes them back unchanged, and
// the cost is worked out from the usage and the model's listed price (the API
// reports tokens, not dollars).

import Anthropic from "@anthropic-ai/sdk"
import { GatewayError, type AssistantMessage, type ChatMessage, type ChatRequest, type ChatResponse, type ModelGateway, type TextPart, type Usage } from "./gateway"

export type AnthropicOptions = {
  apiKey: string
  fetch?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
}

/** Listed USD per million tokens. `longAbove`: prompts over this many tokens are billed at `long`. */
type Price = { input: number; output: number; longAbove?: number; long?: { input: number; output: number } }

export const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longAbove: 100_000, long: { input: 0.5, output: 2.5 } },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
}

/** Cache writes (5-minute) and reads, relative to the input price. */
const CACHE_WRITE = 1.25
const CACHE_READ = 0.1

/** What a reply cost in USD; 0 for a model missing from PRICES. */
export function costOf(model: string, usage: Anthropic.Usage): number {
  const listed = PRICES[model]
  if (!listed) return 0
  const read = usage.cache_read_input_tokens ?? 0
  const write = usage.cache_creation_input_tokens ?? 0
  const prompt = usage.input_tokens + read + write
  const price = listed.long && listed.longAbove && prompt > listed.longAbove ? listed.long : listed
  return (usage.input_tokens * price.input + write * price.input * CACHE_WRITE + read * price.input * CACHE_READ + usage.output_tokens * price.output) / 1_000_000
}

function usageOf(model: string, usage: Anthropic.Usage): Usage {
  const cachedTokens = usage.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
  return {
    promptTokens: usage.input_tokens + cachedTokens + cacheWriteTokens,
    completionTokens: usage.output_tokens,
    cachedTokens,
    cacheWriteTokens,
    // Thinking is billed inside output_tokens; the API does not count it apart.
    reasoningTokens: 0,
    cost: costOf(model, usage),
  }
}

function textBlocks(content: string | TextPart[]): Anthropic.TextBlockParam[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content.map((part) => ({ ...part }))
}

/** Thinking blocks from an earlier reply; anything else in `reasoning_details` (recorded fixtures) is dropped. */
function thinkingBlocks(details: unknown[] | undefined): Anthropic.ContentBlockParam[] {
  return (details ?? []).filter((block): block is Anthropic.ThinkingBlockParam | Anthropic.RedactedThinkingBlockParam => {
    const type = (block as { type?: unknown } | null)?.type
    return type === "thinking" || type === "redacted_thinking"
  })
}

function parseInput(text: string): unknown {
  try { return JSON.parse(text) } catch { return {} }
}

/** The gateway's messages as the Messages API's `system` and `messages`. */
export function toAnthropic(messages: ChatMessage[]): { system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[] } {
  const system: Anthropic.TextBlockParam[] = []
  const out: Anthropic.MessageParam[] = []
  for (const message of messages) {
    if (message.role === "system") {
      system.push(...textBlocks(message.content))
    } else if (message.role === "user") {
      out.push({ role: "user", content: textBlocks(message.content) })
    } else if (message.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [...thinkingBlocks(message.reasoning_details)]
      if (message.content) content.push({ type: "text", text: message.content })
      for (const call of message.tool_calls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.function.name, input: parseInput(call.function.arguments) })
      }
      out.push({ role: "assistant", content })
    } else {
      // Consecutive tool results answer one assistant turn: they go back as one user message.
      const result: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }
      const last = out.at(-1)
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((block) => block.type === "tool_result")) last.content.push(result)
      else out.push({ role: "user", content: [result] })
    }
  }
  return { system, messages: out }
}

const FINISH: Partial<Record<Anthropic.StopReason, string>> = { end_turn: "stop", stop_sequence: "stop", tool_use: "tool_calls", max_tokens: "length" }

/** A Messages API reply in the gateway's shape. */
export function fromAnthropic(reply: Anthropic.Message, requested: string): ChatResponse {
  const text = reply.content.filter((block) => block.type === "text").map((block) => block.text).join("")
  const toolCalls = reply.content.flatMap((block) => block.type === "tool_use"
    ? [{ id: block.id, type: "function" as const, function: { name: block.name, arguments: JSON.stringify(block.input) } }]
    : [])
  const thinking = reply.content.filter((block) => block.type === "thinking" || block.type === "redacted_thinking")
  const message: AssistantMessage = {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    ...(thinking.length ? { reasoning_details: thinking } : {}),
  }
  const model = reply.model || requested
  return {
    id: reply.id,
    model,
    finishReason: reply.stop_reason ? FINISH[reply.stop_reason] ?? reply.stop_reason : null,
    message,
    usage: usageOf(model, reply.usage),
  }
}

export function createAnthropicGateway(options: AnthropicOptions): ModelGateway {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
    fetch: options.fetch,
    timeout: options.timeoutMs ?? 120_000,
  })
  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const { system, messages } = toAnthropic(request.messages)
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: request.model,
        max_tokens: request.maxTokens ?? 16_000,
        messages,
        ...(system.length ? { system } : {}),
      }
      if (request.tools?.length) {
        params.tools = request.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
        }))
      }
      // "none" is for short structured jobs: no thinking. Otherwise the model thinks as
      // much as the effort asks ("minimal" has no Anthropic level, so it is "low").
      if (request.effort === "none") params.thinking = { type: "disabled" }
      else if (request.effort) params.output_config = { effort: request.effort === "minimal" ? "low" : request.effort }

      try {
        return fromAnthropic(await client.messages.create(params), request.model)
      } catch (error) {
        if (error instanceof Anthropic.APIConnectionError) throw new GatewayError(`Anthropic request failed: ${error.message}`)
        if (error instanceof Anthropic.APIError) throw new GatewayError(`Anthropic ${error.status}: ${error.message}`, error.status)
        throw error
      }
    },
  }
}

/** The app's gateway, or null when ANTHROPIC_API_KEY is not set (callers then report "not reviewed yet"). */
export function anthropicFromEnv(env: Record<string, string | undefined> = process.env): ModelGateway | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return null
  return createAnthropicGateway({ apiKey })
}
