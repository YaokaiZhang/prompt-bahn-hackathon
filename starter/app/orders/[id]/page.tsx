"use client"

import Link from "next/link"
import { use, useEffect, useState } from "react"
import { useClockVersion } from "../../components/demo-clock"
import { Shell } from "../../components/shell"
import { OrderPane, type Detail } from "../../components/order-detail"

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const clockVersion = useClockVersion()

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/orders/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(response.status === 404 ? "Order not found" : "Could not load order"); return response.json() as Promise<Detail> })
      .then((data) => { setDetail(data); setError("") })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load order") })
    return () => controller.abort()
  }, [id, clockVersion])

  useEffect(() => {
    if (detail) document.title = `${detail.view.header.reference} · ${detail.view.header.vehicle?.title ?? "Order"} · Control Room`
  }, [detail])

  return <Shell section="orders" snapshotAt={detail?.view.snapshotAt ?? null}><main className="page">
    <nav className="crumbs" aria-label="Breadcrumb"><Link href={detail ? `/?order=${detail.order.id}` : "/"}>Orders</Link><span>/</span><span>{detail?.view.header.reference ?? id}</span></nav>
    {error && <div className="state" role="alert"><h1 className="display">{error}</h1><p>The record could not be opened. <Link className="name-link" href="/">Back to orders</Link></p></div>}
    {!error && !detail && <div aria-busy="true"><div className="hero-photo" /><p className="queue-note">Loading order…</p></div>}
    {detail && <OrderPane detail={detail} />}
  </main></Shell>
}
