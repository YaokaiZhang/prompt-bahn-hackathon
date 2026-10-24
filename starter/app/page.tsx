"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Group } from "@/lib/engine/checks"
import type { ApprovalQueue, OrderChecks, Overview, RecordView } from "@/lib/present/types"
import { OrderCard } from "./components/card"
import { ChecksPanel, GROUP_LABEL } from "./components/checks"
import { Icon } from "./components/icons"
import { BatchApproval } from "./components/proposals"
import { Route, RouteSummary } from "./components/route-line"
import { useClockVersion } from "./components/demo-clock"
import { Shell } from "./components/shell"
import { CarPhoto, Pill, StagePill } from "./components/ui"

const GROUP_ORDER: Group[] = ["needs_action", "in_progress", "normal", "done"]
const GROUP_EMPTY: Record<Group, string> = {
  needs_action: "No order needs a decision right now.",
  in_progress: "No agent work is planned or running.",
  normal: "No order is checked and normal yet.",
  done: "No order is finished with nothing open.",
}

type Preview = { id: string; view: RecordView; checks: OrderChecks | null } | { id: string; error: string }

export default function Home() {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Group>("needs_action")
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const clockVersion = useClockVersion()
  // Proposals waiting for a yes, across orders, for batch approval (ticket 07).
  const [approvals, setApprovals] = useState<ApprovalQueue | null>(null)
  const [batch, setBatch] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/proposals", { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<ApprovalQueue> : null)
      .then((data) => { if (data) setApprovals(data) })
      .catch(() => {})
    return () => controller.abort()
  }, [clockVersion])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/overview?q=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error("Could not load orders"); return response.json() as Promise<Overview> })
        .then((data) => { setOverview(data); setError("") })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load orders") })
    }, search ? 180 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [search, clockVersion])

  // The API already ranks Needs action by urgency; other groups keep lane order.
  const queue = useMemo(() => (overview?.visible ?? []).filter((card) => card.verdict?.group === filter), [overview, filter])
  const matchesIn = (group: Group) => (overview?.visible ?? []).filter((card) => card.verdict?.group === group).length
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
      .then((response) => { if (!response.ok) throw new Error("Could not load this order"); return response.json() as Promise<{ view: RecordView; checks: OrderChecks | null }> })
      .then((data) => setPreview({ id: currentId, view: data.view, checks: data.checks }))
      .catch((cause: unknown) => { if (!controller.signal.aborted) setPreview({ id: currentId, error: cause instanceof Error ? cause.message : "Could not load this order" }) })
    return () => controller.abort()
  }, [currentId, clockVersion])

  const choose = useCallback((id: string) => {
    setSelected(id)
    window.history.replaceState(null, "", `/?order=${encodeURIComponent(id)}`)
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

  const title = GROUP_LABEL[filter]
  const counts = overview?.groupCounts
  const elsewhere = search ? GROUP_ORDER.filter((group) => group !== filter && matchesIn(group) > 0) : []
  const shown = preview && preview.id === currentId ? preview : null

  return <Shell section="orders" fixed snapshotAt={overview?.snapshotAt ?? null}><main className={`home${batch ? " batching" : ""}`}>
    <section className="queue" aria-label="Order queue">
      <header className="queue-head">
        <h1 className="display">{title}</h1>
        <p className="queue-sub">{overview && counts
          ? <><b>{counts.needs_action}</b> of <b>{overview.total}</b> orders need action · <b>{counts.in_progress}</b> with agent work · <b>{counts.normal}</b> checked normal · <Link className="queue-link" href="/board">Lane board</Link></>
          : "Loading the snapshot"}</p>
        {approvals && approvals.waiting.length > 0 && <div className="queue-batch">
          <button type="button" className={`btn btn-s ${batch ? "btn-tertiary" : "btn-primary"}`} aria-pressed={batch} onClick={() => setBatch((value) => !value)}>
            {batch ? "Close batch approval" : "Approve in batch"}
          </button>
          <span><b>{approvals.waiting.length}</b> {approvals.waiting.length === 1 ? "proposal waits" : "proposals wait"} for your yes</span>
        </div>}
      </header>
      <div className="queue-tools">
        <label className="field">
          <span className="sr-only">Search orders</span>
          <Icon name="search" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, car, plate, customer or city" />
          {search && <button type="button" className="field-clear" onClick={() => setSearch("")} aria-label="Clear search"><Icon name="close" size={14} /></button>}
        </label>
        <div className="filters" role="group" aria-label="Show">
          {GROUP_ORDER.map((group) => <FilterButton key={group} active={filter === group} onClick={() => setFilter(group)}
            className={group === "needs_action" ? "need" : ""} label={GROUP_LABEL[group]}
            count={overview ? (search ? matchesIn(group) : counts?.[group] ?? null) : null} />)}
        </div>
      </div>
      {error && <p className="queue-error" role="alert">{error}. Check that the local database is running and seeded.</p>}
      <div className="queue-list">
        {!overview && !error && <ol aria-busy="true">{[0, 1, 2, 3].map((key) => <li className="qcard-skeleton" key={key} />)}</ol>}
        {overview && queue.length === 0 && <p className="queue-note">{search
          ? <>No order in {GROUP_LABEL[filter]} matches “{search}”.{elsewhere.map((group) => <span key={group}> <button type="button" className="btn-link" onClick={() => setFilter(group)}>{matchesIn(group)} in {GROUP_LABEL[group]}</button></span>)}</>
          : GROUP_EMPTY[filter]}</p>}
        {queue.length > 0 && <ol ref={listRef}>{queue.map((card) => <li key={card.id} data-id={card.id}><OrderCard card={card} current={card.id === currentId} onSelect={choose} /></li>)}</ol>}
      </div>
    </section>

    <section className="preview" aria-label={batch ? "Batch approval" : "Selected order"} aria-live="polite">
      {batch && approvals && <BatchApproval queue={approvals} onClose={() => setBatch(false)} />}
      {!batch && !current && <div className="preview-empty"><b>{overview ? "Nothing selected" : "Loading"}</b>{overview && <span>Choose an order from the queue.</span>}</div>}
      {!batch && current && !shown && <div className="preview-inner"><div className="photo" /><p className="queue-note">Loading {current.reference}…</p></div>}
      {!batch && shown && "error" in shown && <div className="preview-empty"><b>{shown.error}</b><Link className="btn btn-tertiary btn-s" href={`/orders/${shown.id}`}>Try the order page</Link></div>}
      {!batch && shown && "view" in shown && <OrderPreview key={shown.id} view={shown.view} checks={shown.checks} position={index + 1} total={queue.length} onNext={() => step(1)} />}
    </section>
  </main></Shell>
}

function FilterButton({ active, onClick, label, count, className = "" }: { active: boolean; onClick: () => void; label: string; count: number | null; className?: string }) {
  return <button type="button" className={`filter ${className}`} aria-pressed={active} onClick={onClick}>
    {label}{count != null && <em>{count}</em>}
  </button>
}

function OrderPreview({ view, checks, position, total, onNext }: { view: RecordView; checks: OrderChecks | null; position: number; total: number; onNext: () => void }) {
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
      {checks && <ChecksPanel orderId={header.id} checks={checks} compact />}
      <Route view={view} />
      <div className="preview-actions">
        <Link className="btn btn-primary" href={`/orders/${header.id}`}>Open order <Icon name="arrow" /></Link>
        <button type="button" className="btn btn-tertiary" onClick={onNext} disabled={position >= total}>Next in queue</button>
        <span className="hint">{position} of {total} · <span className="kbd">J</span> <span className="kbd">K</span> to move</span>
      </div>
    </div>
  </div>
}
