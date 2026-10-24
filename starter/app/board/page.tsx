"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LANES } from "@/lib/present/labels"
import type { Overview, RecordView } from "@/lib/present/types"
import { OrderCard } from "../components/card"
import { Icon } from "../components/icons"
import { Route, RouteSummary } from "../components/route-line"
import { Shell } from "../components/shell"
import { CarPhoto, OpenItems, Pill, StagePill } from "../components/ui"

type Filter = "attention" | "all" | (typeof LANES)[number][0]
type Preview = { id: string; view: RecordView } | { id: string; error: string }

/**
 * The starter's lane board, kept on its own route for reference (spec story 14): lanes and
 * "needs a person" come from the starter's open items, not from the engine's four groups.
 */
export default function LaneBoard() {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("attention")
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/overview?view=board&q=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error("Could not load orders"); return response.json() as Promise<Overview> })
        .then((data) => { setOverview(data); setError("") })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load orders") })
    }, search ? 180 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [search])

  const queue = useMemo(() => {
    const cards = overview?.visible ?? []
    if (filter === "all") return cards
    if (filter === "attention") return rankAttention(cards.filter((card) => card.attention.length > 0))
    return cards.filter((card) => card.displayLane === filter)
  }, [overview, filter])

  const attentionTotal = overview ? Object.values(overview.attentionCounts).reduce((sum, count) => sum + count, 0) : 0
  const current = queue.find((card) => card.id === selected) ?? queue[0] ?? null
  const currentId = current?.id ?? null
  const index = current ? queue.indexOf(current) : -1

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("order")
    if (wanted) setSelected(wanted)
  }, [])

  useEffect(() => {
    if (!currentId) return
    const controller = new AbortController()
    fetch(`/api/orders/${encodeURIComponent(currentId)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("Could not load this order"); return response.json() as Promise<{ view: RecordView }> })
      .then((data) => setPreview({ id: currentId, view: data.view }))
      .catch((cause: unknown) => { if (!controller.signal.aborted) setPreview({ id: currentId, error: cause instanceof Error ? cause.message : "Could not load this order" }) })
    return () => controller.abort()
  }, [currentId])

  const choose = useCallback((id: string) => {
    setSelected(id)
    window.history.replaceState(null, "", `/board?order=${encodeURIComponent(id)}`)
  }, [])

  const step = useCallback((delta: number) => {
    const next = queue[index + delta]
    if (!next) return
    choose(next.id)
    listRef.current?.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [queue, index, choose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, select") || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === "j" || event.key === "ArrowDown") { event.preventDefault(); step(1) }
      if (event.key === "k" || event.key === "ArrowUp") { event.preventDefault(); step(-1) }
      if (event.key === "Enter" && currentId && !target.closest("a, button")) window.location.href = `/orders/${currentId}`
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [step, currentId])

  const title = filter === "attention" ? "Needs a person" : filter === "all" ? "All orders" : LANES.find(([lane]) => lane === filter)?.[1] ?? "Orders"
  const shown = preview && preview.id === currentId ? preview : null

  return <Shell section="orders" fixed snapshotAt={overview?.snapshotAt ?? null}><main className="home">
    <section className="queue" aria-label="Order queue">
      <header className="queue-head">
        <h1 className="display">{title}</h1>
        <p className="queue-sub">The starter&apos;s lane board, for reference · <Link className="queue-link" href="/">Back to the control room</Link></p>
        <p className="queue-sub">{overview
          ? <><b>{attentionTotal}</b> of <b>{overview.total}</b> orders need a person · <b>{overview.counts.moving ?? 0}</b> moving</>
          : "Loading the snapshot"}</p>
      </header>
      <div className="queue-tools">
        <label className="field">
          <span className="sr-only">Search orders</span>
          <Icon name="search" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, car, plate, customer or city" />
          {search && <button type="button" className="field-clear" onClick={() => setSearch("")} aria-label="Clear search"><Icon name="close" size={14} /></button>}
        </label>
        <div className="filters" role="group" aria-label="Show">
          <FilterButton active={filter === "attention"} onClick={() => setFilter("attention")} className="need" label="Needs a person" count={overview ? attentionTotal : null} />
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")} label="All" count={overview?.total ?? null} />
          {LANES.map(([lane, label]) => <FilterButton key={lane} active={filter === lane} onClick={() => setFilter(lane)} label={label} count={overview?.counts[lane] ?? null} lane={lane} />)}
        </div>
      </div>
      {error && <p className="queue-error" role="alert">{error}. Check that the local database is running and seeded.</p>}
      <div className="queue-list">
        {!overview && !error && <ol aria-busy="true">{[0, 1, 2, 3].map((key) => <li className="qcard-skeleton" key={key} />)}</ol>}
        {overview && queue.length === 0 && <p className="queue-note">{search
          ? <>No order matches “{search}” here. <button type="button" className="btn-link" onClick={() => setFilter("all")}>Search all orders</button></>
          : filter === "attention" ? "No order in the snapshot needs a person." : "No orders at this stage."}</p>}
        {queue.length > 0 && <ol ref={listRef}>{queue.map((card) => <li key={card.id} data-id={card.id}><OrderCard card={card} current={card.id === currentId} onSelect={choose} /></li>)}</ol>}
      </div>
    </section>

    <section className="preview" aria-label="Selected order" aria-live="polite">
      {!current && <div className="preview-empty"><b>{overview ? "Nothing selected" : "Loading"}</b>{overview && <span>Choose an order from the queue.</span>}</div>}
      {current && !shown && <div className="preview-inner"><div className="photo" /><p className="queue-note">Loading {current.reference}…</p></div>}
      {shown && "error" in shown && <div className="preview-empty"><b>{shown.error}</b><Link className="btn btn-tertiary btn-s" href={`/orders/${shown.id}`}>Try the order page</Link></div>}
      {shown && "view" in shown && <OrderPreview key={shown.id} view={shown.view} position={index + 1} total={queue.length} onNext={() => step(1)} />}
    </section>
  </main></Shell>
}

function FilterButton({ active, onClick, label, count, lane, className = "" }: { active: boolean; onClick: () => void; label: string; count: number | null; lane?: string; className?: string }) {
  return <button type="button" className={`filter ${className}`} aria-pressed={active} onClick={onClick}>
    {lane && <span className={`stage-dot stage-${lane}`} />}{label}{count != null && <em>{count}</em>}
  </button>
}

function OrderPreview({ view, position, total, onNext }: { view: RecordView; position: number; total: number; onNext: () => void }) {
  const { header, story } = view
  return <div className="preview-inner">
    <CarPhoto view={view} sizes="(max-width: 1400px) 60vw, 900px" priority />
    <div className="preview-body">
      <div className="preview-pills">
        <StagePill lane={header.lane} label={header.laneLabel} />
        <Pill>{header.reference}</Pill>
        <Pill>{header.customer.name}</Pill>
        {header.vehicle?.plate && <Pill>{header.vehicle.plate}</Pill>}
      </div>
      <h2 className="display preview-title">{header.vehicle?.title ?? "Vehicle not linked"}</h2>
      <p className={`preview-story tone-${story.tone}`}>{story.headline}</p>
      {story.detail && <p className="preview-detail">{story.detail}</p>}
      <RouteSummary view={view} />
      <OpenItems view={view} limit={3} />
      <Route view={view} />
      <div className="preview-actions">
        <Link className="btn btn-primary" href={`/orders/${header.id}`}>Open order <Icon name="arrow" /></Link>
        <button type="button" className="btn btn-tertiary" onClick={onNext} disabled={position >= total}>Next in queue</button>
        <span className="hint">{position} of {total} · <span className="kbd">J</span> <span className="kbd">K</span> to move</span>
      </div>
    </div>
  </div>
}

const TONE_RANK = { danger: 0, warn: 1, accent: 2, neutral: 3, ok: 4 } as const

const ACTIONABLE = new Set(["pickup_slot", "requested_pickup", "driver_start", "promise", "eta"])

/** Most serious first; then orders with a next date still ahead, soonest first; then the rest. */
function rankAttention(cards: Overview["visible"]) {
  const ahead = (card: Overview["visible"][number]) => card.decisive && ACTIONABLE.has(card.decisive.key) ? 0 : 1
  return [...cards].sort((a, b) => TONE_RANK[a.attentionTone] - TONE_RANK[b.attentionTone]
    || ahead(a) - ahead(b)
    || (a.decisive?.start ?? "9").localeCompare(b.decisive?.start ?? "9"))
}
