// Gateways that need no network: the scripted gateway replays fixtures in tests,
// and the recording gateway wraps a real one to capture fixtures in the eval.

import type { Fixture, FixtureTurn } from "./fixtures"
import { GatewayError, NO_USAGE, type ChatRequest, type ChatResponse, type ModelGateway } from "./gateway"

export type ScriptedGateway = ModelGateway & {
  /** Every request received, in order. */
  readonly calls: ChatRequest[]
}

function toResponse(turn: FixtureTurn): ChatResponse {
  const toolCalls = turn.message.tool_calls?.map((call) => ({
    ...call,
    function: {
      name: call.function.name,
      arguments: typeof call.function.arguments === "string" ? call.function.arguments : JSON.stringify(call.function.arguments),
    },
  }))
  const { tool_calls: _raw, ...message } = turn.message
  return {
    ...turn,
    message: { ...message, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
    usage: { ...NO_USAGE, ...turn.usage },
    model: turn.model ?? "scripted",
    finishReason: turn.finishReason ?? (toolCalls?.length ? "tool_calls" : "stop"),
  }
}

/**
 * Replays fixtures by `request.subject` (the order reference). The turn is the number
 * of assistant messages already in the request, so replay is stateless and a cached
 * review simply never asks.
 */
export function createScriptedGateway(fixtures: Fixture[]): ScriptedGateway {
  const bySubject = new Map(fixtures.map((fixture) => [fixture.reference, fixture]))
  const calls: ChatRequest[] = []
  return {
    calls,
    async chat(request) {
      calls.push(request)
      const fixture = bySubject.get(request.subject)
      if (!fixture) throw new GatewayError(`No fixture for ${request.subject}`)
      const turn = request.messages.filter((message) => message.role === "assistant").length
      const reply = fixture.turns[turn]
      if (!reply) throw new GatewayError(`Fixture ${request.subject} has no turn ${turn + 1}`)
      return toResponse(reply)
    },
  }
}

export type RecordingGateway = ModelGateway & {
  /** The replies received per subject, in order, as fixture turns. */
  turns(subject: string): FixtureTurn[]
}

export function createRecordingGateway(inner: ModelGateway): RecordingGateway {
  const recorded = new Map<string, FixtureTurn[]>()
  return {
    async chat(request) {
      const response = await inner.chat(request)
      const list = recorded.get(request.subject) ?? []
      list.push(structuredClone(response))
      recorded.set(request.subject, list)
      return response
    },
    turns: (subject) => recorded.get(subject) ?? [],
  }
}
