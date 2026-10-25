"use client"

// The two order boards (spec .scratch/publishing):
//   /       orders that are not normal: Needs action as situation cards in the main
//           area, Confirm before publishing and In progress in a rail beside it, each
//           soonest deadline first;
//   /board  the pipeline: every order from unpublished to done, one lane per stage,
//           ranked by state (Needs action > Confirm before publishing > In progress > Normal),
//           then by when the order was created.

import Link from "next/link"
import type { ReactNode } from "react"
import type { Group } from "@/lib/engine/checks"
import type { BoardCard } from "@/lib/present/types"
import { OrderTile } from "./card"
import { Icon } from "./icons"

export type Column = { key: string; label: string; cards: BoardCard[] }

/** The pipeline's rank of states within a column. */
const STATE_RANK: Record<Group, number> = { needs_action: 0, solved: 1, in_progress: 2, normal: 3, done: 4 }

/** Soonest deadline first (the rules' earliest deadline, else the card's deciding date), then reference. */
export function bySoonestDeadline(a: BoardCard, b: BoardCard): number {
  const due = (card: BoardCard) => card.verdict?.dueAt ?? card.decisive?.start ?? "9"
  return due(a).localeCompare(due(b)) || a.reference.localeCompare(b.reference)
}

/** State first (Needs action > Confirm before publishing > In progress > Normal), then the order's time, oldest first. */
export function byStateThenOrderTime(a: BoardCard, b: BoardCard): number {
  const rank = (card: BoardCard) => STATE_RANK[card.verdict?.group ?? "normal"]
  return rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt) || a.reference.localeCompare(b.reference)
}

/** A heading with its count; the layout says the rest. */
export function LaneHead({ label, count, children }: { label: string; count: number | null; children?: ReactNode }) {
  return <header className="lane-head"><h2>{label}</h2><em>{count ?? ""}</em>{children}</header>
}

/** The pipeline: one tonal lane per stage, compact tiles inside. */
export function Lanes({ columns, loading = false }: { columns: Column[]; loading?: boolean }) {
  return <div className="lanes">
    {columns.map((column) => <section key={column.key} className="lane" aria-label={column.label}>
      <LaneHead label={column.label} count={loading ? null : column.cards.length} />
      {loading ? <ol aria-busy="true">{[0, 1, 2].map((key) => <li className="tile-skeleton" key={key} />)}</ol>
        : <ol>{column.cards.map((card) => <li key={card.id}><OrderTile card={card} tagged /></li>)}</ol>}
    </section>)}
  </div>
}

/** Switches between the two boards. */
export function BoardSwitch({ current }: { current: "attention" | "pipeline" }) {
  return <nav className="board-switch" aria-label="Order views">
    <Link href="/" aria-current={current === "attention" ? "page" : undefined}>Not normal</Link>
    <Link href="/board" aria-current={current === "pipeline" ? "page" : undefined}>Pipeline</Link>
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

/** Title, the board switch and the search on one row. */
export function BoardHead({ title, children }: { title: string; children?: ReactNode }) {
  return <header className="board-head">
    <h1 className="display">{title}</h1>
    {children}
  </header>
}
