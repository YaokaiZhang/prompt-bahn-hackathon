// Test setup for reviewer tests: the real dataset files, read once per process.

import { reviewSourceFromFiles, type ReviewSource } from "./source"

let source: Promise<ReviewSource> | null = null

export function testReviewSource(): Promise<ReviewSource> {
  source ??= reviewSourceFromFiles()
  return source
}
