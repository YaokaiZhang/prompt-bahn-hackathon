"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type PointerEvent } from "react"
import { useClockVersion } from "./demo-clock"

/** How often the avatar re-reads the agent's status (ms). */
const POLL_MS = 5000
const SIZE = 72
const MARGIN = 12
/** Room kept under the avatar for its "working..." or approval note. */
const LABEL_ROOM = 40
const STORAGE_KEY = "agent-avatar-position"

type Status = { working: boolean; inProgress: number; awaitingApproval: number }
type Point = { x: number; y: number }

function useAgentStatus(): Status | null {
  const [status, setStatus] = useState<Status | null>(null)
  const clockVersion = useClockVersion()
  useEffect(() => {
    let stopped = false
    const read = () => fetch("/api/agent-status")
      .then((response) => response.ok ? response.json() as Promise<Status> : null)
      .then((data) => { if (!stopped && data) setStatus(data) })
      .catch(() => {})
    read()
    const timer = setInterval(read, POLL_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [clockVersion])
  return status
}

const clamp = (point: Point): Point => ({
  x: Math.min(Math.max(point.x, MARGIN), window.innerWidth - SIZE - MARGIN),
  y: Math.min(Math.max(point.y, MARGIN), window.innerHeight - SIZE - LABEL_ROOM),
})

/**
 * The agent as a floating avatar the operator can drag anywhere; the spot is remembered.
 * Animated with "working..." while any order is In progress; still otherwise, with a red dot
 * counting the Solved orders waiting for the operator's yes. A click (not a drag) opens the orders.
 */
export function AgentAvatar() {
  const status = useAgentStatus()
  const router = useRouter()
  const [position, setPosition] = useState<Point | null>(null)
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let saved: Point | null = null
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") } catch {}
    setPosition(clamp(saved ?? { x: 24, y: window.innerHeight - SIZE - LABEL_ROOM - 12 }))
    const onResize = () => setPosition((current) => current && clamp(current))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  if (!position) return null

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y, startX: event.clientX, startY: event.clientY, moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current) return
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return
    if (!current.moved) setDragging(true)
    current.moved = true
    setPosition(clamp({ x: event.clientX - current.dx, y: event.clientY - current.dy }))
  }
  const onPointerUp = () => {
    const current = drag.current
    drag.current = null
    setDragging(false)
    if (!current) return
    if (current.moved) localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
    else router.push("/")
  }

  const working = status?.working ?? false
  const waiting = !working ? status?.awaitingApproval ?? 0 : 0
  const doneText = `${waiting} new task${waiting === 1 ? "" : "s"} done and need${waiting === 1 ? "s" : ""} further approval`
  const label = working ? "Agent: working" : waiting > 0 ? `Agent: ${doneText}` : "Agent: idle"

  return <button
    type="button"
    className={`agent-avatar${working ? " is-working" : ""}${dragging ? " is-dragging" : ""}`}
    style={{ left: position.x, top: position.y }}
    aria-label={`${label}. Drag to move, click to open orders`}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={() => { drag.current = null; setDragging(false) }}
  >
    {/* Two files: CSS animations inside an SVG <img> can't be paused from the page. */}
    <img src={working ? "/agent-avatar.svg" : "/agent-avatar-static.svg"} alt="" width={SIZE} height={SIZE} draggable={false} />
    {working && <span className="agent-avatar-working" aria-hidden>working<span>.</span><span>.</span><span>.</span></span>}
    {waiting > 0 && <>
      <span className="agent-avatar-dot" aria-hidden>{waiting}</span>
      <span className="agent-avatar-note" aria-hidden>{doneText}</span>
    </>}
  </button>
}
