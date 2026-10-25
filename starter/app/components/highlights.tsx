"use client"

import { useSyncExternalStore } from "react"
import { Icon } from "./icons"

// Orders the operator highlights for the agent avatar to follow. Kept in this browser only.

const STORAGE_KEY = "agent-highlights"
const CHANGE = "agent-highlights-change"
const NONE: string[] = []

let cachedRaw: string | null = null
let cached: string[] = NONE

function read(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      const parsed: unknown = JSON.parse(raw ?? "[]")
      cached = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : NONE
    } catch { cached = NONE }
  }
  return cached
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) onChange() }
  window.addEventListener(CHANGE, onChange)
  window.addEventListener("storage", onStorage)
  return () => { window.removeEventListener(CHANGE, onChange); window.removeEventListener("storage", onStorage) }
}

/** The highlighted order ids, oldest first. */
export function useHighlights(): string[] {
  return useSyncExternalStore(subscribe, read, () => NONE)
}

export function toggleHighlight(orderId: string) {
  const ids = read()
  const next = ids.includes(orderId) ? ids.filter((id) => id !== orderId) : [...ids, orderId]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(CHANGE))
}

/** A pill that highlights the order for the agent avatar, or takes the highlight off. */
export function HighlightButton({ orderId }: { orderId: string }) {
  const on = useHighlights().includes(orderId)
  return <button type="button" className={`pill highlight-toggle${on ? " is-on" : ""}`} aria-pressed={on}
    title={on ? "The agent avatar follows this order. Click to stop." : "Follow this order on the agent avatar"}
    onClick={() => toggleHighlight(orderId)}>
    <Icon name="star" size={13} />{on ? "Highlighted" : "Highlight"}
  </button>
}

/** A small star on a queue card whose order is highlighted. */
export function HighlightMark({ orderId }: { orderId: string }) {
  const on = useHighlights().includes(orderId)
  return on ? <Icon name="star" size={14} className="highlight-mark" aria-label="Highlighted" /> : null
}
