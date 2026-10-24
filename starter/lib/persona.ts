/**
 * Demo personas. No password: the picker sets a cookie and the proxy routes on it.
 * Real access control is out of scope; the published demo sits behind basic auth.
 * Pure module, safe to import from the proxy, server components and client components.
 */

export const PERSONAS = ["operator", "site", "driver"] as const
export type Persona = (typeof PERSONAS)[number]

export const PERSONA_COOKIE = "persona"

export const PERSONA_LABEL: Record<Persona, string> = { operator: "Operator", site: "Site", driver: "Driver" }

/** Icon names from app/components/icons.tsx. */
export const PERSONA_ICON: Record<Persona, string> = { operator: "people", site: "building", driver: "driver" }

export const PICKER_PATH = "/login"
export const PHONE_PATH = "/phone"

export function parsePersona(value: string | null | undefined): Persona | null {
  return (PERSONAS as readonly string[]).includes(value ?? "") ? value as Persona : null
}

/** Where a persona lands after choosing it. */
export function homeFor(persona: Persona): string {
  return persona === "operator" ? "/" : PHONE_PATH
}

export type GateResult = { kind: "allow" } | { kind: "redirect"; to: string } | { kind: "deny"; status: 401 | 403 }

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`)

/** Paths every persona may use: the picker, the phone page and its API. Everything else is the operator's. */
function isShared(pathname: string): boolean {
  return under(pathname, PICKER_PATH) || under(pathname, PHONE_PATH) || under(pathname, "/api/phone")
}

/** Decide what a request for `pathname` gets, given the persona cookie (or none). */
export function gate(persona: Persona | null, pathname: string): GateResult {
  const api = under(pathname, "/api")
  if (!persona) {
    if (under(pathname, PICKER_PATH)) return { kind: "allow" }
    if (api) return { kind: "deny", status: 401 }
    return { kind: "redirect", to: pathname === "/" ? PICKER_PATH : `${PICKER_PATH}?next=${encodeURIComponent(pathname)}` }
  }
  if (persona === "operator" || isShared(pathname)) return { kind: "allow" }
  return api ? { kind: "deny", status: 403 } : { kind: "redirect", to: homeFor(persona) }
}

/** A `next` value from the picker is only followed if it is a local path this persona may open. */
export function landingFor(persona: Persona, next: string | null | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && gate(persona, next.split(/[?#]/)[0]).kind === "allow"
    && !next.startsWith(PICKER_PATH)) return next
  return homeFor(persona)
}
