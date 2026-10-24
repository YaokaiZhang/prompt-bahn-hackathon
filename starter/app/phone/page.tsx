import type { Metadata } from "next"
import { Icon } from "@/app/components/icons"
import { Shell } from "@/app/components/shell"
import { currentPersona } from "@/lib/persona-server"

export const metadata: Metadata = { title: "Phone · Control Room" }

/** The mock phone for the Site and Driver personas. A placeholder until live calls ring here (ticket 11). */
export default async function PhonePage() {
  const persona = await currentPersona()
  const who = persona === "driver" ? "the assigned driver" : persona === "site" ? "a pickup or delivery place" : "a site or a driver"
  return <Shell><main className="phone-page">
    <h1 className="display">Phone</h1>
    <section className="phone" aria-label="Mock phone">
      <div className="phone-idle">
        <span className="phone-icon"><Icon name="phone" size={28} /></span>
        <b>No calls right now</b>
        <p>When the agent calls {who}, the call rings here with the caller and the order reference.</p>
      </div>
    </section>
    <p className="picker-note">Mock phone. No real numbers are dialled.</p>
  </main></Shell>
}
