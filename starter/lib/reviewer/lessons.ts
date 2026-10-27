// Approved lessons as the agents read them (spec .scratch/self-improving-agents). A
// lesson is one or two plain sentences the operator approved; only its text reaches a
// prompt. A call gets the lessons whose tags match it (a lesson with no tags matches
// every call), and its cache key gets a hash of exactly those, so approving a lesson
// misses only the results it could change. No lessons: no block, keys as before.
// Storage, decisions and the cap live in lib/engine/lessons.ts.

import { createHash } from "node:crypto"

/** At most this many approved lessons per agent (the engine refuses an 11th). */
export const MAX_APPROVED_LESSONS = 10

/** What a prompt needs of an approved lesson. */
export type InjectedLesson = { id: string; text: string; appliesTo: string[] }

/** The approved lessons of one agent; the app reads them through a short in-process cache. */
export type LessonFeed = () => Promise<InjectedLesson[]>

/** The lessons that apply to a call tagged `tags` (failing rule ids, card kinds), in a stable order. */
export function lessonsFor(lessons: InjectedLesson[], tags: string[]): InjectedLesson[] {
  return lessons.filter((lesson) => !lesson.appliesTo.length || lesson.appliesTo.some((tag) => tags.includes(tag)))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_APPROVED_LESSONS)
}

/** A hash of exactly these lessons; "" for none, so a key without lessons stays as it was. */
export function lessonsHash(lessons: InjectedLesson[]): string {
  if (!lessons.length) return ""
  const rows = [...lessons].sort((a, b) => a.id.localeCompare(b.id)).map((lesson) => [lesson.id, lesson.text])
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex")
}

/** The prompt block, or null for none. */
export function renderLessons(lessons: InjectedLesson[]): string | null {
  if (!lessons.length) return null
  return `Lessons the operator approved. Each comes from the operator's corrections of earlier work like this; apply it where it fits.\n${lessons.map((lesson) => `- ${lesson.text}`).join("\n")}`
}
