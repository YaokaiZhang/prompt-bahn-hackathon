"use client"

// The two order boards (spec .scratch/publishing):
//   /       orders that are not normal, one column per state, soonest deadline first;
//   /board  the pipeline: every order from unpublished to done, one column per stage,
//           ranked by state (Needs action > Confirm before publishing > In progress > Normal),
//           then by when the order was created.

import Link from "next/link"
import type { ReactNode } from "react"
import type { Group } from "@/lib/engine/checks"
import type { BoardCard } from "@/lib/present/types"
import { OrderCard } from "./card"
import { Icon } from "./icons"

export type Column = { key: string; label: string; cards: BoardCard[]; empty: string; className?: string }

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

export function Columns({ columns, tagged = false, loading = false }: { columns: Column[]; tagged?: boolean; loading?: boolean }) {
  return <div className="columns" role="list">
    {columns.map((column) => <section key={column.key} className={`column ${column.className ?? ""}`} role="listitem" aria-label={column.label}>
      <header className="column-head"><h2>{column.label}</h2><em>{loading ? "" : column.cards.length}</em></header>
      {loading ? <ol aria-busy="true">{[0, 1].map((key) => <li className="qcard-skeleton" key={key} />)}</ol>
        : column.cards.length === 0 ? <p className="column-empty">{column.empty}</p>
        : <ol>{column.cards.map((card) => <li key={card.id}><OrderCard card={card} tagged={tagged} /></li>)}</ol>}
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

export function BoardHead({ title, sub, children }: { title: string; sub: ReactNode; children?: ReactNode }) {
  return <header className="board-head">
    <div><h1 className="display">{title}</h1><p className="queue-sub">{sub}</p></div>
    {children}
  </header>
}
