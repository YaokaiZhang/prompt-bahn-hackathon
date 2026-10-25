import type { Metadata } from "next"
import { Icon } from "@/app/components/icons"
import { Shell } from "@/app/components/shell"
import { PERSONA_ICON, PERSONA_LABEL, PERSONAS, type Persona } from "@/lib/persona"
import { currentPersona } from "@/lib/persona-server"
import { choosePersona } from "./actions"

export const metadata: Metadata = { title: "Choose a persona · Control Room" }

const ABOUT: Record<Persona, { what: string }> = {
  operator: { what: "Works the orders and makes the decisions." },
  site: { what: "Answers calls to a pickup or delivery place." },
  driver: { what: "Answers driver calls and sees open jobs." },
}

/** The persona picker. No password: the demo site sits behind basic auth, and this only decides which screens you see. */
export default async function PickerPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next }, current] = await Promise.all([searchParams, currentPersona()])
  return <Shell><main className="picker">
    <header className="picker-head">
      <h1 className="display">Choose a persona</h1>
    </header>
    <form action={choosePersona} className="picker-options">
      {next && <input type="hidden" name="next" value={next} />}
      {PERSONAS.map((persona) => <button key={persona} type="submit" name="persona" value={persona} className="picker-option" aria-current={persona === current ? "true" : undefined}>
        <span className="picker-icon"><Icon name={PERSONA_ICON[persona]} size={22} /></span>
        <span className="picker-text">
          <b>{PERSONA_LABEL[persona]}{persona === current && <em>Current</em>}</b>
          <span>{ABOUT[persona].what}</span>
        </span>
        <Icon name="arrow" className="picker-go" />
      </button>)}
    </form>
    <p className="picker-note">Fictional data. No real phone numbers, customers or bookings.</p>
  </main></Shell>
}
