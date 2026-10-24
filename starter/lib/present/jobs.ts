// The driver market as the Driver's phone shows it (spec .scratch/publishing): every
// order live for drivers, with its places, windows, fee and, on a demanding job, the
// travel planner's suggestion.

import type { OrderState } from "@/lib/engine/engine"
import { jobWindows } from "@/lib/engine/publishing"
import { num, rows, str, type Bundle } from "./bundle"
import { fmtMoney } from "./time"
import type { DriverJob } from "./types"

export function driverJob(order: OrderState, bundle: Bundle): DriverJob | null {
  const { publication } = order
  if (!publication.live || !publication.check) return null
  const offer = rows(bundle, "market_offers").find((row) => row.details.status === "PUBLISHED")
  const fee = num(offer?.details.fee_cents)
  const vehicle = bundle.items[0]?.vehicle
  const windows = jobWindows(bundle)
  return {
    orderId: order.id, reference: order.reference,
    car: vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(" ") || null : null,
    from: publication.check.from, to: publication.check.to,
    pickupWindow: windows.pickup, deliveryWindow: windows.delivery,
    fee: fee !== null ? fmtMoney(fee, str(offer?.details.currency) ?? "EUR") : null,
    publishedAt: publication.published?.at ?? str(offer?.details.published_at),
    check: publication.check, plan: publication.plan, budgetEur: publication.budgetEur,
  }
}

/** Live jobs, soonest pickup first. */
export function driverJobs(orders: OrderState[], bundleOf: (orderId: string) => Bundle | null): DriverJob[] {
  return orders.flatMap((order) => {
    const bundle = bundleOf(order.id)
    const job = bundle ? driverJob(order, bundle) : null
    return job ? [job] : []
  }).sort((a, b) => (a.pickupWindow?.start ?? "9").localeCompare(b.pickupWindow?.start ?? "9") || a.reference.localeCompare(b.reference))
}
