"use client"

import type { RecordView } from "@/lib/present/types"
import { KeyDates, RecordHero } from "./record/header"
import { RecordsPanel } from "./record/records"
import { ActivitySection, ConversationsSection, DecisionsSection, EvidenceSection, RouteSection } from "./record/sections"
import { OpenItems } from "./ui"

export type Detail = { order: { id: string; reference: string }; view: RecordView }

export function OrderPane({ detail }: { detail: Detail }) {
  const { view } = detail
  return <>
    <RecordHero view={view} />
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
