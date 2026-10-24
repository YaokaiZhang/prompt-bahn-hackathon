"use client"

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react"
import { choosePersona } from "@/app/login/actions"
import { PERSONA_ICON, PERSONA_LABEL, PERSONAS, type Persona } from "@/lib/persona"
import { Icon } from "./icons"

const PersonaContext = createContext<Persona | null>(null)

/** The root layout reads the cookie on the server and hands the persona to client pages through this. */
export function PersonaProvider({ persona, children }: { persona: Persona | null; children: ReactNode }) {
  return <PersonaContext.Provider value={persona}>{children}</PersonaContext.Provider>
}

export function usePersona(): Persona | null {
  return useContext(PersonaContext)
}

/** The current persona as a pill in the bar; opens a small menu to switch without logging out. */
export function PersonaSwitch() {
  const persona = usePersona()
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const el = menu.current
      if (!el?.open) return
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !el.contains(event.target as Node)) el.open = false
    }
    document.addEventListener("click", close)
    document.addEventListener("keydown", close)
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close) }
  }, [])
  if (!persona) return null
  return <details className="persona" ref={menu}>
    <summary aria-label={`Persona: ${PERSONA_LABEL[persona]}. Switch persona`}>
      <Icon name={PERSONA_ICON[persona]} />
      <span>{PERSONA_LABEL[persona]}</span>
      <Icon name="chevron" size={12} className="persona-chevron" />
    </summary>
    <form action={choosePersona} className="persona-menu">
      <p>Switch persona</p>
      {PERSONAS.map((option) => <button key={option} type="submit" name="persona" value={option} aria-current={option === persona ? "true" : undefined}>
        <Icon name={PERSONA_ICON[option]} />{PERSONA_LABEL[option]}{option === persona && <Icon name="check" size={14} className="persona-check" />}
      </button>)}
    </form>
  </details>
}
