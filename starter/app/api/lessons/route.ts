// Lessons (spec .scratch/self-improving-agents). Operator-only: the proxy keeps other
// personas out of /api, and only the operator may decide, so it is checked here too.
//   GET                                          -> LessonsView: every lesson, newest first
//   POST { action: "approve", lessonId, note? }  -> LessonsView (refused past 10 approved per agent)
//   POST { action: "reject", lessonId, note? }
//   POST { action: "retire", lessonId, note? }
// A refused decision answers 409 with `{ error }`.

import { NextRequest, NextResponse } from "next/server"
import { applyLessonAction, LessonRefused, lessonsView, parseLessonAction, readLessons } from "@/lib/engine/lessons"
import { getStore, lessonFeeds } from "@/lib/engine/server"
import { requirePersona } from "@/lib/persona-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function operator(): Promise<boolean> {
  return requirePersona("operator").then(() => true, () => false)
}

export async function GET() {
  if (!await operator()) return NextResponse.json({ error: "Not available to this persona" }, { status: 403 })
  return NextResponse.json(await lessonsView(await readLessons(getStore())))
}

export async function POST(request: NextRequest) {
  if (!await operator()) return NextResponse.json({ error: "Only the operator decides on lessons" }, { status: 403 })
  const action = parseLessonAction(await request.json().catch(() => null))
  if (!action) return NextResponse.json({ error: "Unknown lesson action" }, { status: 400 })
  try {
    const lessons = await applyLessonAction(getStore(), action)
    lessonFeeds().refresh()
    return NextResponse.json(await lessonsView(lessons))
  } catch (error) {
    if (error instanceof LessonRefused) return NextResponse.json({ error: error.message }, { status: 409 })
    throw error
  }
}
