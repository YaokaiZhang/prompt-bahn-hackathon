// Plain-text rendering of reviewer results and eval scores for the command line.

import type { ReviewResult } from "./reviewer"
import type { RunScore } from "./score"

export function money(cost: number): string {
  return `$${cost.toFixed(4)}`
}

export function formatReview(result: ReviewResult): string {
  const lines: string[] = []
  if (result.status === "not_reviewed") {
    lines.push(`${result.reference}: ${result.reason}`)
    lines.push(`  case file: ${result.recordsRead} records, hash ${result.hash.slice(0, 12)}`)
    lines.push(`  cost: ${money(result.cost)}`)
    return lines.join("\n")
  }
  lines.push(`${result.reference}: reviewed${result.cached ? " (from cache, no model call)" : ""}. Read ${result.recordsRead} records.`)
  if (result.summary) lines.push(`  ${result.summary}`)
  if (result.findings.length === 0) lines.push("  No findings: nothing to ask.")
  result.findings.forEach((finding, i) => {
    lines.push("")
    lines.push(`  Finding ${i + 1}: ${finding.title}${finding.repaired ? " (repaired)" : ""}`)
    for (const item of finding.conflict) lines.push(`    - [${item.recordId}] ${item.field}: "${item.quote}"`)
    lines.push(`    Ask: ${finding.ask.role} (${finding.ask.contactType}) ${finding.ask.name}, named in [${finding.ask.contactRecordId}] "${finding.ask.contactQuote}"`)
    lines.push(`    Who pays: ${finding.whoPays}`)
    lines.push(`    Policy row: ${finding.policyRow}`)
    lines.push(`    Question: ${finding.question}`)
    lines.push(`    Why: ${finding.why}`)
  })
  for (const drop of result.dropped) lines.push(`  Dropped "${drop.title ?? "untitled"}": ${drop.errors.join("; ")}`)
  lines.push("")
  const u = result.usage
  lines.push(`  Model ${result.model}; ${result.turns} turn(s), ${result.toolCalls} tool call(s)${result.refusedToolCalls ? `, ${result.refusedToolCalls} refused` : ""}`)
  lines.push(`  Tokens: ${u.promptTokens} in (${u.cachedTokens} from prompt cache, ${u.cacheWriteTokens} written), ${u.completionTokens} out (${u.reasoningTokens} reasoning)`)
  lines.push(`  Cost: ${money(result.cost)}${result.cached ? ` (first run ${money(u.cost)})` : ""}`)
  return lines.join("\n")
}

export function formatScore(run: RunScore): string {
  const lines = run.cases.map((item) => {
    const checks = item.checks.map((check) => `${check.pass ? "+" : "-"}${check.name}`).join(" ")
    const detail = item.checks.filter((check) => !check.pass).map((check) => `${check.name}: ${check.detail}`).join("; ")
    return `${item.reference}  ${item.points}/${item.max}  ${checks}  ${money(item.cost)}${detail ? `\n    ${detail}` : ""}`
  })
  lines.push(`Score ${run.points}/${run.max}; model cost ${money(run.cost)}`)
  return lines.join("\n")
}
