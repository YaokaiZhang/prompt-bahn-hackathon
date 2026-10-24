import { cookies } from "next/headers"
import { parsePersona, PERSONA_COOKIE, type Persona } from "./persona"

/** The persona chosen in this browser, or null. Works in server components, server actions and route handlers. */
export async function currentPersona(): Promise<Persona | null> {
  return parsePersona((await cookies()).get(PERSONA_COOKIE)?.value)
}

/**
 * The persona, narrowed to the ones allowed here. The proxy already routes people away,
 * so this is a second check for route handlers and actions; it throws if the persona is not allowed.
 */
export async function requirePersona<P extends Persona>(...allowed: P[]): Promise<P> {
  const persona = await currentPersona()
  if (!persona || !(allowed as Persona[]).includes(persona)) throw new Error(`Not available to persona ${persona ?? "none"}`)
  return persona as P
}
