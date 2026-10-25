"use client"

// The Briefing in the shell (ticket 13): the unread badge on the nav item and a toast
// for each new digest or push. The feed re-reads /api/briefing on load, after every
// clock move (CLOCK_EVENT) and after items are read (BRIEFING_EVENT). Reading it
// also delivers what is due, so the 09:00 digest arrives on the first page load.

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import type { BriefingItem, ProseSegment } from "@/lib/engine/engine"
import type { BriefingView } from "@/lib/present/types"
import { CLOCK_EVENT } from "./demo-clock"
import { Icon } from "./icons"

export const BRIEFING_EVENT = "control-room:briefing"

const TOASTED_KEY = "briefing-toasted"
const TOAST_MS = 10_000
const MAX_TOASTS = 3

// Items already toasted in this browser: `${id}@${deliveredAt}`, so an item delivered
// again after a reset toasts again. Kept in memory too, for when storage is blocked.
const toasted = new Set<string>()
let loaded = false

function loadToasted() {
  if (loaded) return
  loaded = true
  try {
    for (const key of JSON.parse(window.localStorage.getItem(TOASTED_KEY) ?? "[]") as string[]) toasted.add(key)
  } catch { /* storage blocked: memory only */ }
}

function saveToasted() {
  try { window.localStorage.setItem(TOASTED_KEY, JSON.stringify([...toasted].slice(-200))) } catch { /* memory only */ }
}

const toastKey = (item: BriefingItem) => `${item.id}@${item.deliveredAt}`

export type BriefingFeed = { unread: number; toasts: BriefingItem[]; extra: number; dismiss: (id?: string) => void }

/** The Operator's Briefing feed: unread count and the toasts to show. Inert for other personas. */
export function useBriefingFeed(enabled: boolean): BriefingFeed {
  const [unread, setUnread] = useState(0)
  // Each toast stays TOAST_MS from when it appeared; a newer batch goes on top.
  const [shown, setShown] = useState<{ item: BriefingItem; until: number }[]>([])
  const [extra, setExtra] = useState(0)
  const toasts = shown.map((entry) => entry.item)

  useEffect(() => {
    if (!enabled) return
    let live = true
    const read = () => fetch("/api/briefing")
      .then((response) => response.ok ? response.json() as Promise<BriefingView> : null)
      .then((view) => {
        if (!view || !live) return
        setUnread(view.unread)
        loadToasted()
        const fresh = view.items.filter((item) => !item.read && !toasted.has(toastKey(item)))
        if (!fresh.length) return
        for (const item of fresh) toasted.add(toastKey(item))
        saveToasted()
        const until = Date.now() + TOAST_MS
        setShown((current) => [...fresh.map((item) => ({ item, until })), ...current].slice(0, MAX_TOASTS))
        setExtra(Math.max(0, fresh.length - MAX_TOASTS))
      })
      .catch(() => {})
    read()
    window.addEventListener(CLOCK_EVENT, read)
    window.addEventListener(BRIEFING_EVENT, read)
    return () => { live = false; window.removeEventListener(CLOCK_EVENT, read); window.removeEventListener(BRIEFING_EVENT, read) }
  }, [enabled])

  useEffect(() => {
    if (!shown.length) return
    const next = Math.min(...shown.map((entry) => entry.until))
    const timer = setTimeout(() => {
      const now = Date.now()
      setShown((current) => current.filter((entry) => entry.until > now))
      setExtra(0)
    }, Math.max(0, next - Date.now()))
    return () => clearTimeout(timer)
  }, [shown])

  const dismiss = useCallback((id?: string) => {
    setShown((current) => id ? current.filter((entry) => entry.item.id !== id) : [])
    if (!id) setExtra(0)
  }, [])

  return { unread, toasts, extra, dismiss }
}

/** "Morning digest", or a push's title. */
export function itemSummary(item: BriefingItem): string {
  if (item.kind === "push") return item.text
  const { counts } = item.facts
  return `${counts.needs_action} ${counts.needs_action === 1 ? "problem" : "problems"} · ${counts.urgent} urgent · ${counts.in_progress} in progress`
}

export function BriefingToasts({ feed }: { feed: BriefingFeed }) {
  return <div className="toasts" role="status" aria-live="polite">
    {feed.toasts.map((item) => <div key={item.id} className={`toast toast-${item.kind}`}>
      <Icon name={item.kind === "push" ? "alert" : "inbox"} size={16} className={item.kind === "push" ? "tone-danger" : "tone-neutral"} />
      <div className="toast-body">
        <b>{item.kind === "push" ? "Urgent" : "Briefing"} · {item.title}</b>
        <span>{itemSummary(item)}</span>
        <span className="toast-links">
          <Link className="ref-link" href={`/briefing#${encodeURIComponent(item.id)}`} onClick={() => feed.dismiss(item.id)}>Open in Briefing</Link>
          {item.kind === "push" && <Link className="ref-link" href={`/orders/${encodeURIComponent(item.orderId)}`} onClick={() => feed.dismiss(item.id)}>{item.reference}</Link>}
        </span>
      </div>
      <button type="button" className="toast-close" aria-label={`Dismiss ${item.title}`} onClick={() => feed.dismiss(item.id)}><Icon name="close" size={14} /></button>
    </div>)}
    {feed.extra > 0 && <div className="toast toast-more">
      <span>{feed.extra} more new in the <Link className="ref-link" href="/briefing" onClick={() => feed.dismiss()}>Briefing</Link></span>
    </div>}
  </div>
}

/** Digest prose: text runs and order links. */
export function Prose({ segments }: { segments: ProseSegment[] }) {
  return <>{segments.map((segment, index) => "text" in segment
    ? <span key={index}>{segment.text}</span>
    : <Link key={index} className="ref-link" href={`/orders/${encodeURIComponent(segment.order.orderId)}`}>{segment.order.reference}</Link>)}</>
}
