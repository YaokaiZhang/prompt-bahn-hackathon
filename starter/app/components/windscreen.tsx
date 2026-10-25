"use client"

// The windscreen landing (design: operator-landing.html): the view through a car's windscreen,
// a steering wheel that follows the pointer with the agent avatar on its hub, and the choices
// as pills on an arc around the wheel. A click drives forward, then goes. Used by the persona
// picker (/login) and the Operator's start page (/start).

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react"

/** How long the drive-forward runs before the page changes (ms). */
const DRIVE_MS = 900

/** A choice: a link (`href`) or, inside the picker's form, a submit button with `name`/`value`. */
export type WindscreenChoice = { key: string; label: string; badge?: ReactNode; title?: string; current?: boolean }
  & ({ href: string } | { name: string; value: string })

export function Windscreen({ eyebrow, title, hint, label, choices, angles, goingTo, action, hidden }: {
  eyebrow: string
  title: ReactNode
  hint: string
  /** The accessible name of the choices. */
  label: string
  choices: WindscreenChoice[]
  /** Each choice's place on the arc, in degrees from straight up. */
  angles: number[]
  /** The toast while driving to a choice, before its label: "Driving to" shows "Driving to Orders…". */
  goingTo: string
  /** For submit choices: the form's server action and its hidden fields. */
  action?: (formData: FormData) => Promise<void>
  hidden?: Record<string, string>
}) {
  const router = useRouter()
  const root = useRef<HTMLDivElement>(null)
  const wheel = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const [driving, setDriving] = useState<WindscreenChoice | null>(null)

  useEffect(() => {
    const el = root.current
    if (!el || !wheel.current || !nav.current) return
    const geom = () => {
      const box = wheel.current!.getBoundingClientRect()
      return { cx: window.innerWidth / 2, cy: box.top + box.height / 2, r: box.width / 2 }
    }
    const layout = () => {
      const { cx, cy, r } = geom()
      const radius = r + Math.max(58, r * 0.26)
      Array.from(nav.current!.querySelectorAll<HTMLElement>(".ws-choice")).forEach((pill, index) => {
        const angle = (angles[index] ?? 0) * Math.PI / 180
        pill.style.setProperty("--x", `${cx + radius * Math.sin(angle) * 1.12}px`)
        pill.style.setProperty("--y", `${cy - radius * Math.cos(angle) * 0.98}px`)
      })
    }
    let target = 0
    let rot = 0
    let frame = 0
    const onMove = (event: PointerEvent) => {
      const { cx, cy } = geom()
      const dx = event.clientX - cx
      const dy = event.clientY - cy
      // The wheel's 12 o'clock mark points at the pointer, clamped like a real wheel's lock.
      let deg = Math.atan2(dx, -dy) * 180 / Math.PI
      if (dy > 0) deg = Math.sign(dx || 1) * 90
      target = Math.max(-80, Math.min(80, deg))
      el.style.setProperty("--px", `${(0.5 - event.clientX / window.innerWidth) * 50}px`)
      el.style.setProperty("--py", `${(0.5 - event.clientY / window.innerHeight) * 28}px`)
    }
    const onLeave = () => { target = 0 }
    const tick = () => {
      rot += (target - rot) * 0.12
      el.style.setProperty("--rot", `${rot.toFixed(2)}deg`)
      frame = requestAnimationFrame(tick)
    }
    layout()
    tick()
    window.addEventListener("resize", layout)
    window.addEventListener("pointermove", onMove)
    document.documentElement.addEventListener("pointerleave", onLeave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", layout)
      window.removeEventListener("pointermove", onMove)
      document.documentElement.removeEventListener("pointerleave", onLeave)
    }
  }, [angles])

  const go = (choice: WindscreenChoice) => (event: MouseEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    if (driving) return
    setDriving(choice)
    const submitter = event.currentTarget
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    setTimeout(() => {
      if ("href" in choice) router.push(choice.href)
      else form.current?.requestSubmit(submitter as HTMLButtonElement)
    }, still ? 0 : DRIVE_MS)
  }

  const pills = choices.map((choice, index) => {
    const className = `ws-choice${driving?.key === choice.key ? " is-going" : ""}${choice.current ? " is-current" : ""}`
    const body = <>{choice.label}{choice.badge != null && <span className="ws-badge">{choice.badge}</span>}</>
    const style = { "--i": index } as CSSProperties
    return "href" in choice
      ? <Link key={choice.key} href={choice.href} className={className} style={style} title={choice.title} onClick={go(choice)}>{body}</Link>
      : <button key={choice.key} type="submit" name={choice.name} value={choice.value} className={className} style={style} title={choice.title}
        aria-current={choice.current ? "true" : undefined} onClick={go(choice)}>{body}</button>
  })

  return <div ref={root} className={`ws${driving ? " is-driving" : ""}`}>
    <div className="ws-parallax" aria-hidden="true"><div className="ws-scene" /></div>
    <div className="ws-glass" aria-hidden="true" /><div className="ws-sheen" aria-hidden="true" />
    <div className="ws-roof" aria-hidden="true" /><div className="ws-pillar is-left" aria-hidden="true" /><div className="ws-pillar is-right" aria-hidden="true" />
    <div className="ws-mirror" aria-hidden="true" />
    <div className="ws-dash" aria-hidden="true" />

    <header className="ws-head">
      <div className="ws-brand"><BahnMark /><span>{eyebrow}</span></div>
      <h1>{title}</h1>
      <p className="ws-hint">{hint}</p>
    </header>

    {action
      ? <form ref={form} action={action}>
        {Object.entries(hidden ?? {}).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <nav ref={nav} className="ws-choices" aria-label={label}>{pills}</nav>
      </form>
      : <nav ref={nav} className="ws-choices" aria-label={label}>{pills}</nav>}

    <div ref={wheel} className="ws-wheel" aria-hidden="true"><SteeringWheel /></div>
    <div className="ws-avatar" aria-hidden="true"><img src="/agent-avatar.svg" alt="" /></div>
    <div className="ws-toast" role="status">{driving ? `${goingTo} ${driving.label}…` : ""}</div>
  </div>
}

const MARK = "M15.2105 0C18.2887 0 20.7841 2.49479 20.7841 5.57175C20.784 8.64861 18.2886 11.1431 15.2105 11.1431H5.57817C5.1046 11.1431 4.7207 11.5268 4.7207 12.0002C4.72081 12.4735 5.10467 12.8573 5.57817 12.8573H18.426C21.5042 12.8573 23.9996 15.3517 23.9996 18.4287C23.9995 21.5055 21.5041 24 18.426 24H0V19.2858H18.426C18.8995 19.2858 19.2834 18.902 19.2835 18.4287C19.2835 17.9553 18.8996 17.5715 18.426 17.5715H5.57817C2.50005 17.5715 0.0047187 15.0771 0.00460556 12.0002C0.00460556 8.92325 2.49998 6.42888 5.57817 6.42888H15.2105C15.684 6.42888 16.0679 6.04503 16.068 5.57175C16.068 5.09837 15.6841 4.71462 15.2105 4.71462H0.00125606V0H15.2105Z"

function BahnMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={MARK} /></svg>
}

function SteeringWheel() {
  return <svg viewBox="-300 -300 600 600">
    <defs>
      <linearGradient id="ws-rim" x1="0" y1="-1" x2="0" y2="1"><stop offset="0" stopColor="#3a352c" /><stop offset=".5" stopColor="#1b1914" /><stop offset="1" stopColor="#0c0b09" /></linearGradient>
      <linearGradient id="ws-spoke" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a2721" /><stop offset="1" stopColor="#0f0e0b" /></linearGradient>
      <linearGradient id="ws-acc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fd6a31" /><stop offset="1" stopColor="#fd4a61" /></linearGradient>
    </defs>
    <circle r="268" fill="none" stroke="url(#ws-rim)" strokeWidth="56" />
    <circle r="268" fill="none" stroke="#fffef7" strokeOpacity=".07" strokeWidth="56" strokeDasharray="2 9" />
    <circle r="294" fill="none" stroke="#fffef7" strokeOpacity=".18" strokeWidth="1.5" />
    <circle r="242" fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="2" />
    {/* The 12 o'clock mark: where the wheel points. */}
    <rect x="-9" y="-296" width="18" height="52" rx="9" fill="url(#ws-acc)" />
    <path d="M-244 -20 L-70 -34 L-70 34 L-244 28 Z" fill="url(#ws-spoke)" />
    <path d="M244 -20 L70 -34 L70 34 L244 28 Z" fill="url(#ws-spoke)" />
    <path d="M-34 70 L34 70 L40 244 L-40 244 Z" fill="url(#ws-spoke)" />
    <circle r="92" fill="url(#ws-spoke)" stroke="#fffef7" strokeOpacity=".12" strokeWidth="2" />
    <g transform="translate(-24 -24) scale(2)" fill="#fffef7" fillOpacity=".9"><path d={MARK} /></g>
  </svg>
}
