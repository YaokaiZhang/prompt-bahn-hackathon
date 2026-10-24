import { NextResponse, type NextRequest } from "next/server"
import { gate, parsePersona, PERSONA_COOKIE } from "@/lib/persona"

/** Sends people without a persona to the picker and keeps Site and Driver on their phone page. */
export function proxy(request: NextRequest) {
  const result = gate(parsePersona(request.cookies.get(PERSONA_COOKIE)?.value), request.nextUrl.pathname)
  if (result.kind === "allow") return NextResponse.next()
  if (result.kind === "deny") {
    return NextResponse.json({ error: result.status === 401 ? "Choose a persona first" : "Not available to this persona" }, { status: result.status })
  }
  return NextResponse.redirect(new URL(result.to, request.url))
}

export const config = {
  // Everything except Next's own assets and files served from public/.
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|webp|avif|gif|ico|woff2?|txt)$).*)"],
}
