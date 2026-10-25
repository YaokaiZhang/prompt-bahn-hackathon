"use client"

import { useEffect, useState } from "react"
import type { Overview } from "@/lib/present/types"
import { useClockVersion } from "./demo-clock"

/** How often a board re-reads the orders (ms): the agent groups, calls and publishes in the background. */
const POLL_MS = 5000

/** The overview (every order card with the engine's verdict), re-read on search, clock moves and every few seconds. */
export function useOverview(search: string): { overview: Overview | null; error: string } {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const clockVersion = useClockVersion()
  useEffect(() => {
    const controller = new AbortController()
    const read = () => fetch(`/api/overview?q=${encodeURIComponent(search)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Could not load orders"); return response.json() as Promise<Overview> })
      .then((data) => { setOverview(data); setError("") })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load orders") })
    const first = setTimeout(read, search ? 180 : 0)
    const timer = setInterval(read, POLL_MS)
    return () => { clearTimeout(first); clearInterval(timer); controller.abort() }
  }, [search, clockVersion])
  return { overview, error }
}
