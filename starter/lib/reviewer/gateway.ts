// The ModelGateway port: every model call in the control room goes through it and
// reports its cost. Messages follow the OpenAI-compatible chat-completions shape (the
// app first ran on OpenRouter); the Anthropic adapter maps it onto the Messages API and
// the scripted adapter (tests) replays recorded replies in the same shape.

export type CacheControl = { type: "ephemeral" }
export type TextPart = { type: "text"; text: string; cache_control?: CacheControl }

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }

export type AssistantMessage = {
  role: "assistant"
  content: string | null
  tool_calls?: ToolCall[]
  /** Provider reasoning blocks; passed back unchanged on the next turn (needed for tool use with reasoning). */
  reasoning_details?: unknown[]
}

export type ChatMessage =
  | { role: "system"; content: string | TextPart[] }
  | { role: "user"; content: string | TextPart[] }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string }

export type JsonSchema = { type: string; [key: string]: unknown }

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: JsonSchema } }

/** "none" turns reasoning off (short structured jobs such as the tier-2 turn check). */
export type Effort = "none" | "minimal" | "low" | "medium" | "high"

export type ChatRequest = {
  /** What the call is for, e.g. "reviewer". Not sent to the provider; used for logs and replay. */
  job: string
  /** What it is about, e.g. an order reference. Not sent to the provider; scripted replay keys on it. */
  subject: string
  model: string
  effort?: Effort
  messages: ChatMessage[]
  tools?: ToolSpec[]
  maxTokens?: number
}

export type Usage = {
  promptTokens: number
  completionTokens: number
  /** Prompt tokens read from the provider's prompt cache. */
  cachedTokens: number
  /** Prompt tokens written to the provider's prompt cache. */
  cacheWriteTokens: number
  reasoningTokens: number
  /** What the call cost, in USD. */
  cost: number
}

export type ChatResponse = {
  message: AssistantMessage
  finishReason: string | null
  usage: Usage
  /** The model that actually answered. */
  model: string
  id?: string
}

export interface ModelGateway {
  chat(request: ChatRequest): Promise<ChatResponse>
}

export class GatewayError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = "GatewayError"
  }
}

export const NO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 0 }

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cost: a.cost + b.cost,
  }
}
