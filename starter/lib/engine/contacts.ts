// Contact types from the order's records (spec "Contact lookup and contact types",
// ADR 0001). The type, never the persona who answers or the reviewer's label, decides
// what the agent may do. Customer side:
//   - the paying customer: `orders.customer_id`;
//   - a customer-given contact: an endpoint contact with stated_by CUSTOMER_ORDER_INPUT,
//     unless its handle is a third-party site's own desk (that site profile's pickup
//     email, as on CD-420015): then the agent reaches the site, not the customer's person;
//   - a customer-owned site: a site whose customer_id is the order's customer, and the
//     endpoint contacts at that site.
// The reviewer's finding check applies the same rules (without the site-desk exception,
// so it is stricter) to the record a finding cites (lib/reviewer/validate.ts); the engine
// applies them again to the contact it would actually reach, which can be a fallback
// (the pickup endpoint, the site profile), and the rules use them for planned site calls.
//
// Pure: bundle in, contact type out.

import { rows, str, type Bundle, type RelatedRow } from "@/lib/present/bundle"
import type { ContactType } from "@/lib/reviewer/policy"

/** Is the site the order's customer's own? */
export function customerOwnsSite(bundle: Bundle, siteId: string | null | undefined): boolean {
  if (!siteId) return false
  const site = bundle.sites.get(siteId)
  return !!site && str(site.details.customer_id) === bundle.customer.id
}

/** The managed site an endpoint is at: its own site_id, else the order's site on that boundary. */
export function endpointSite(bundle: Bundle, endpoint: RelatedRow): string | null {
  const own = str(endpoint.details.site_id)
  if (own) return own
  const pickup = endpoint.details.boundary === "PICKUP"
  const siteId = pickup ? bundle.order.pickupSiteId : bundle.order.deliverySiteId
  const addressId = pickup ? bundle.order.pickupAddressId : bundle.order.deliveryAddressId
  return siteId ?? bundle.places.get(addressId)?.managedSiteId ?? null
}

/** The site whose profile's pickup email is this handle, if any. */
function siteByEmail(bundle: Bundle, handle: string | null): string | null {
  if (!handle) return null
  for (const [id, site] of bundle.sites) if (str(site.details.pickup_contact_email) === handle) return id
  return null
}

/** The type of an endpoint's contact: customer-given, at a customer-owned site, or a third party. */
export function endpointContactType(bundle: Bundle, endpoint: RelatedRow): ContactType {
  const siteId = endpointSite(bundle, endpoint)
  if (customerOwnsSite(bundle, siteId)) return "customer_owned_site"
  if (endpoint.details.stated_by === "CUSTOMER_ORDER_INPUT") {
    // The customer typed in a site's own desk (a site profile's pickup email, e.g. CD-420015's
    // site-005): the agent reaches that site, not a person the customer gave us.
    const desk = siteByEmail(bundle, str(endpoint.details.contact_handle))
    if (desk) return customerOwnsSite(bundle, desk) ? "customer_owned_site" : "third_party_site"
    return "customer_given_contact"
  }
  return "third_party_site"
}

/** The customer-side type a record forces on a contact it names, or null when it forces none. */
export function customerSideOf(bundle: Bundle, recordId: string): ContactType | null {
  if (recordId === bundle.customer.id) return "paying_customer"
  const endpoint = rows(bundle, "order_endpoint_details").find((row) => row.id === recordId)
  if (endpoint) {
    const type = endpointContactType(bundle, endpoint)
    return type === "third_party_site" ? null : type
  }
  if (bundle.sites.has(recordId) && customerOwnsSite(bundle, recordId)) return "customer_owned_site"
  return null
}
