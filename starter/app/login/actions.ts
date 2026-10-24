"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { landingFor, parsePersona, PERSONA_COOKIE } from "@/lib/persona"

/** Sets the persona cookie and opens that persona's landing page (or the page it was sent away from). */
export async function choosePersona(formData: FormData): Promise<void> {
  const persona = parsePersona(String(formData.get("persona") ?? ""))
  if (!persona) redirect("/login")
  ;(await cookies()).set(PERSONA_COOKIE, persona, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
  const next = formData.get("next")
  redirect(landingFor(persona, typeof next === "string" ? next : null))
}
