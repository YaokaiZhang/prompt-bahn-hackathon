// What the rules and the call layer both read about one order (pure): whether it is
// finished, the selected delivery promise, and the assignments on the road. One reading,
// so the tight-ETA check (calls.ts) and R12 (rules.ts) never disagree on the promise.

import { bool, finalDeliveryPoint, rows, str, type Bundle, type RelatedRow } from "@/lib/present/bundle"

/** Delivered or cancelled: a status, or a cancellation recorded on an order whose status was not updated. */
export function isFinished(bundle: Bundle): boolean {
  const status = bundle.order.status
  return status === "DELIVERED" || status === "CANCELLED" || !!str(bundle.order.details.cancelled_at)
}

/** A time window on a point with a purpose; `selected` null = selected or not. */
export function windowOn(bundle: Bundle, pointId: string | undefined, purpose: string, selected: boolean | null): RelatedRow | null {
  return rows(bundle, "time_windows").find((row) =>
    row.details.point_id === pointId && row.details.purpose === purpose
    && (selected === null || bool(row.details.is_selected) === selected)) ?? null
}

/** The selected customer delivery promise on the order's final delivery point. */
export function selectedPromise(bundle: Bundle): RelatedRow | null {
  return windowOn(bundle, finalDeliveryPoint(bundle)?.id, "CUSTOMER_DELIVERY_PROMISE", true)
}

/** Assignments in progress: a driver is on the road with a car of this order. */
export function movingAssignments(bundle: Bundle): RelatedRow[] {
  return rows(bundle, "work_assignments").filter((row) => row.details.order_id === bundle.order.id && row.details.status === "IN_PROGRESS")
}
