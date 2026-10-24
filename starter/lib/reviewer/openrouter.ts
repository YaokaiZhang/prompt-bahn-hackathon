// The OpenRouter adapter of the ModelGateway port: OpenAI-compatible chat
// completions with tool calling, per-job reasoning effort, Anthropic prompt
// caching (`cache_control` on a system content part, passed through as given)
// and usage accounting (`usage.cost` in credits on every reply).

import { GatewayError, type AssistantMessage, type ChatRequest, type ChatResponse, type ModelGateway, type Usage } from "./gateway"

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

export type OpenRouterOptions = {
  apiKey: string
  fetch?: typeof fetch
  url?: string
  /** Shown on OpenRouter's dashboard. */
  appName?: string
  appUrl?: string
  timeoutMs?: number
}

type Json = Record<string, unknown>

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {}
}

function usageOf(raw: unknown): Usage {
  const usage = obj(raw)
  const prompt = obj(usage.prompt_tokens_details)
  const completion = obj(usage.completion_tokens_details)
  return {
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    cachedTokens: num(prompt.cached_tokens),
    cacheWriteTokens: num(prompt.cache_write_tokens),
    reasoningTokens: num(completion.reasoning_tokens),
    cost: num(usage.cost),
  }
}

function errorText(body: unknown, fallback: string): string {
  const error = obj(obj(body).error)
  const meta = obj(error.metadata)
  const message = typeof error.message === "string" ? error.message : fallback
  return typeof meta.raw === "string" ? `${message}: ${meta.raw}` : message
}

export function createOpenRouterGateway(options: OpenRouterOptions): ModelGateway {
  const doFetch = options.fetch ?? fetch
  const url = options.url ?? OPENROUTER_URL
  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const body: Json = {
        model: request.model,
        messages: request.messages,
        usage: { include: true },
      }
      if (request.tools?.length) body.tools = request.tools
      if (request.effort) body.reasoning = { effort: request.effort }
      if (request.maxTokens) body.max_tokens = request.maxTokens

      let response: Response
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
            "x-title": options.appName ?? "Car Delivery Control Room",
            ...(options.appUrl ? { "http-referer": options.appUrl } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
        })
      } catch (error) {
        const cause = (error as Error & { cause?: { message?: string } }).cause?.message
        throw new GatewayError(`OpenRouter request failed: ${(error as Error).message}${cause ? ` (${cause})` : ""}`)
      }
      const text = await response.text()
      let parsed: unknown = null
      try { parsed = JSON.parse(text) } catch { /* reported below */ }
      if (!response.ok) throw new GatewayError(`OpenRouter ${response.status}: ${errorText(parsed, text.slice(0, 200))}`, response.status)
      if (!parsed || obj(parsed).error) throw new GatewayError(`OpenRouter error: ${errorText(parsed, text.slice(0, 200))}`, num(obj(obj(parsed).error).code) || undefined)

      const reply = obj(parsed)
      const choice = obj(Array.isArray(reply.choices) ? reply.choices[0] : null)
      const raw = obj(choice.message)
      const message: AssistantMessage = {
        role: "assistant",
        content: typeof raw.content === "string" ? raw.content : null,
        ...(Array.isArray(raw.tool_calls) && raw.tool_calls.length ? { tool_calls: raw.tool_calls as AssistantMessage["tool_calls"] } : {}),
        ...(Array.isArray(raw.reasoning_details) && raw.reasoning_details.length ? { reasoning_details: raw.reasoning_details } : {}),
      }
      return {
        id: typeof reply.id === "string" ? reply.id : undefined,
        model: typeof reply.model === "string" ? reply.model : request.model,
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
        message,
        usage: usageOf(reply.usage),
      }
    },
  }
}

/** The app's gateway, or null when OPENROUTER_API_KEY is not set (callers then report "not reviewed yet"). */
export function openRouterFromEnv(env: Record<string, string | undefined> = process.env): ModelGateway | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return null
  return createOpenRouterGateway({ apiKey, appUrl: env.OPENROUTER_APP_URL })
}
