// Reviewer fixtures: the model's replies for one order, turn by turn, as the eval
// script recorded them (origin "recorded") or as written by hand from the PRD's
// expected findings (origin "hand-written"). The scripted gateway replays them.
// Running `npm run review:eval` with ANTHROPIC_API_KEY overwrites them.

import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ChatResponse, ToolCall, Usage } from "./gateway"

/** A tool call as a fixture may spell it: recorded arguments are JSON text, hand-written ones may be objects. */
export type FixtureToolCall = Omit<ToolCall, "function"> & { function: { name: string; arguments: string | Record<string, unknown> } }

export type FixtureTurn = Omit<ChatResponse, "message" | "usage"> & {
  message: { role: "assistant"; content: string | null; tool_calls?: FixtureToolCall[]; reasoning_details?: unknown[] }
  usage?: Partial<Usage>
}

export type Fixture = {
  /** The order reference the turns answer, e.g. "CD-420516". */
  reference: string
  origin: "hand-written" | "recorded"
  note?: string
  model?: string | null
  recordedAt?: string | null
  /** Hash of the case file the turns were recorded against (recorded fixtures only). */
  caseFileHash?: string | null
  turns: FixtureTurn[]
}

const ROOT = join(process.cwd(), "lib", "reviewer", "fixtures")

/** The 7 eval cases: hand-written until `npm run review:eval` records real replies here. */
export const CASE_FIXTURE_DIR = join(ROOT, "cases")

/** Hand-written test scenarios (valid, repair, drop, tool use, nothing to ask). The eval never touches them. */
export const SCENARIO_FIXTURE_DIR = join(ROOT, "scenarios")

export async function loadFixtures(dir = CASE_FIXTURE_DIR): Promise<Fixture[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort()
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8")) as Fixture))
}

export async function writeFixture(fixture: Fixture, dir = CASE_FIXTURE_DIR): Promise<string> {
  const path = join(dir, `${fixture.reference}.json`)
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`)
  return path
}
