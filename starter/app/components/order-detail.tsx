"use client"

import { useEffect } from "react"
import type { OrderChecks, RecordView } from "@/lib/present/types"
import { ChecksPanel } from "./checks"
import { KeyDates, RecordHero } from "./record/header"
import { RecordsPanel } from "./record/records"
import { ActivitySection, ConversationsSection, DecisionsSection, EvidenceSection, RouteSection } from "./record/sections"
import { OpenItems } from "./ui"

export type Detail = { order: { id: string; reference: string }; view: RecordView; checks: OrderChecks | null }

/** A check's source link points at a folded record section: open it and bring it into view. */
function useOpenLinkedSection() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      const target = id ? document.getElementById(id) : null
      if (!target) return
      if (target instanceof HTMLDetailsElement) target.open = true
      target.scrollIntoView({ block: "start" })
    }
    open()
    window.addEventListener("hashchange", open)
    return () => window.removeEventListener("hashchange", open)
  }, [])
}

export function OrderPane({ detail }: { detail: Detail }) {
  const { view, checks } = detail
  useOpenLinkedSection()
  return <>
    <RecordHero view={view} />
    {checks && <ChecksPanel orderId={detail.order.id} checks={checks} />}
    <div className={view.attention.length ? "panel" : "panel-quiet"} id="attention"><OpenItems view={view} /></div>
    <KeyDates tiles={view.tiles} />
    <RouteSection view={view} />
    <ConversationsSection view={view} />
    <EvidenceSection view={view} />
    <DecisionsSection view={view} />
    <ActivitySection view={view} />
    <RecordsPanel view={view} orderId={detail.order.id} />
  </>
}
