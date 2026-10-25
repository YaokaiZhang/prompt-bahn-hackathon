"use client"

// What the two order boards (components/queue.tsx) share: their order and the
// controls above the queue.
//   /       Needs action, the orders that are not normal, soonest deadline first;
//   /board  Overview, every order by stage, ranked by state (Blocked > Fixed, review it > In progress >
//           Normal), then by when the order was created.

import Link from "next/link"
import type { Group } from "@/lib/engine/checks"
import type { BoardCard } from "@/lib/present/types"
import { Icon } from "./icons"

/** The overview's rank of states within a stage. */
const STATE_RANK: Record<Group, number> = { needs_action: 0, solved: 1, in_progress: 2, normal: 3, done: 4 }

/** Soonest deadline first (the rules' earliest deadline, else the card's deciding date), then reference. */
export function bySoonestDeadline(a: BoardCard, b: BoardCard): number {
  const due = (card: BoardCard) => card.verdict?.dueAt ?? card.decisive?.start ?? "9"
  return due(a).localeCompare(due(b)) || a.reference.localeCompare(b.reference)
}

/** State first (Blocked > Fixed, review it > In progress > Normal), then the order's time, oldest first. */
export function byStateThenOrderTime(a: BoardCard, b: BoardCard): number {
  const rank = (card: BoardCard) => STATE_RANK[card.verdict?.group ?? "normal"]
  return rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt) || a.reference.localeCompare(b.reference)
}

/** Switches between the two boards. */
export function BoardSwitch({ current }: { current: "attention" | "overview" }) {
  return <nav className="board-switch" aria-label="Order views">
    <Link href="/" aria-current={current === "attention" ? "page" : undefined}>Needs action</Link>
    <Link href="/board" aria-current={current === "overview" ? "page" : undefined}>Overview</Link>
  </nav>
}

export function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="field board-search">
    <span className="sr-only">Search orders</span>
    <Icon name="search" />
    <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Reference, car, plate, customer or city" />
    {value && <button type="button" className="field-clear" onClick={() => onChange("")} aria-label="Clear search"><Icon name="close" size={14} /></button>}
  </label>
}
