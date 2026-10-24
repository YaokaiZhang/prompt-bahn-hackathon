"use client"

// Calls (ticket 10): the agent's calls on an order, with the live transcript, the
// tier, the state and the cost meter (model cost plus phone time, against what the
// same call would cost an operator). The order page re-reads while a call runs.

import { useEffect, useRef, useState } from "react"
import type { BlockedCall, Call, CallLineView, CallState } from "@/lib/engine/calls"
import type { TurnCheck, TurnPath } from "@/lib/engine/voice-agent"
import type { Tone } from "@/lib/present/types"
import { CLOCK_EVENT } from "./demo-clock"
import { Icon } from "./icons"
import { More, Pill } from "./ui"

const STATE_LABEL: Record<CallState, string> = {
  ringing: "Ringing", answered: "Answered", declined: "Declined", no_answer: "No answer",
  availability: "Asking if now is good", callback_time: "Asking when to call back", tier1: "Keypad questions", tier2: "Voice agent", ended: "Ended",
}

const OUTCOME_LABEL: Record<NonNullable<Call["outcome"]>, { label: string; tone: Tone }> = {
  resolved: { label: "Resolved", tone: "ok" },
  callback: { label: "Callback scheduled", tone: "accent" },
  handover: { label: "Needs a person", tone: "warn" },
  unreachable: { label: "Unreachable", tone: "warn" },
}

/** True while the order has a call running or one about to start: the page keeps re-reading. */
export function callsAreLive(calls: Call[] = [], lines: CallLineView[] = []): boolean {
  return calls.some((call) => call.state !== "ended") || lines.some((line) => line.status === "to_call" || line.status === "callback_due")
}

const eur = (value: number) => value === 0 ? "€0" : value < 0.01 ? `€${value.toFixed(4)}` : `€${value.toFixed(2)}`
const usd = (value: number) => value === 0 ? "$0" : `$${value < 0.01 ? value.toFixed(5) : value.toFixed(3)}`

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function demoTime(iso: string): string {
  return `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso))} UTC`
}

function PlayButton({ audioId }: { audioId: string }) {
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = () => {
    if (playing) { audio.current?.pause(); setPlaying(false); return }
    audio.current ??= new Audio(`/api/phone/audio/${audioId}`)
    audio.current.currentTime = 0
    audio.current.onended = () => setPlaying(false)
    audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  return <button type="button" className="call-play" onClick={toggle} aria-label={playing ? "Stop the prompt" : "Play the prompt"} aria-pressed={playing}>
    {playing ? <span className="call-play-stop" /> : <span className="call-play-tri" />}
  </button>
}

function CostMeter({ call }: { call: Call }) {
  const { cost } = call
  const share = cost.operatorEur > 0 ? Math.min(1, cost.totalEur / cost.operatorEur) : 0
  return <div className="call-meter" aria-label="Cost of this call">
    <div className="call-meter-row">
      <span className="call-meter-figure"><span className="call-meter-label">This call</span><b>{eur(cost.totalEur)}</b></span>
      <span className="call-meter-figure"><span className="call-meter-label">Same call by an operator</span><b>{eur(cost.operatorEur)}</b></span>
    </div>
    <div className="call-meter-bar" role="img" aria-label={`This call costs ${eur(cost.totalEur)} against ${eur(cost.operatorEur)} for an operator`}>
      <span style={{ width: `${Math.max(share * 100, 0.8)}%` }} />
    </div>
    <p className="call-meter-parts">
      Model {usd(cost.modelUsd)} · phone {clock(cost.phoneSeconds)} at {eur(cost.rates.phonePerMinuteEur)}/min = {eur(cost.phoneEur)} · ringing {clock(cost.ringSeconds)} · operator at {eur(cost.rates.operatorPerMinuteEur)}/min, one minute at least
    </p>
  </div>
}

const PATH_LABEL: Record<TurnPath, string> = {
  voice: "Audio model",
  replaced: "Checked reply (the audio model's was not allowed)",
  fallback: "Fallback: transcribed, checked, spoken",
}

const NEXT_LABEL: Record<TurnCheck["next"], string> = { continue: "Keep talking", resolved: "End: resolved", handover: "End: hand over to a person" }

/** Haiku's structured result for one tier-2 turn. */
function TurnCheckView({ check, cost }: { check: TurnCheck; cost: number }) {
  return <dl className="call-check">
    {check.failed && <><dt>Check</dt><dd>Failed: safe reply, nothing recorded.</dd></>}
    {check.claims.length > 0 && <><dt>Said</dt><dd>{check.claims.join("; ")}</dd></>}
    {check.changes.length > 0 && <><dt>Change</dt><dd>{check.changes.map((change) => change.change).join("; ")} <span className="call-line-meta">Needs your yes</span></dd></>}
    {check.conflicts.length > 0 && <><dt>Conflict</dt><dd>{check.conflicts.join("; ")}</dd></>}
    {check.replyOk === false && <><dt>Reply</dt><dd>Not used{check.replyIssue ? `: ${check.replyIssue}` : ""}</dd></>}
    <dt>Next</dt><dd>{NEXT_LABEL[check.next]}{cost ? <span className="call-line-meta">Haiku · {usd(cost)}</span> : null}</dd>
  </dl>
}

function Transcript({ call }: { call: Call }) {
  const start = new Date(call.transcript[0]?.wallAt ?? call.startedAt).getTime()
  const end = useRef<HTMLLIElement | null>(null)
  const live = call.state !== "ended"
  useEffect(() => { if (live) end.current?.scrollIntoView({ block: "nearest" }) }, [live, call.transcript.length])
  return <ol className="call-transcript" aria-live={live ? "polite" : "off"}>
    {call.transcript.map((line, i) => <li key={i} className={`call-line call-line-${line.by}${line.check ? " call-line-check" : ""}`} ref={i === call.transcript.length - 1 ? end : undefined}>
      <span className="call-line-at">{clock((new Date(line.wallAt).getTime() - start) / 1000)}</span>
      <span className="call-line-by">{line.check ? "Check" : line.by === "agent" ? "Agent" : line.by === "callee" ? "Callee" : ""}{line.tier > 1 && line.by === "agent" && !line.check ? ` · tier ${line.tier}` : ""}</span>
      {line.check ? <TurnCheckView check={line.check} cost={line.cost} /> : <span className="call-line-text">
        {line.text}
        {line.path && <span className="call-line-meta">{PATH_LABEL[line.path]}{line.cost ? ` · ${usd(line.cost)}` : ""}</span>}
        {!line.path && line.tier > 1 && line.by === "callee" && line.cost > 0 && <span className="call-line-meta">Transcribed · {usd(line.cost)}</span>}
      </span>}
      {line.audioId ? <PlayButton audioId={line.audioId} /> : <span />}
    </li>)}
  </ol>
}

function CallCard({ call }: { call: Call }) {
  const live = call.state !== "ended"
  const outcome = call.outcome ? OUTCOME_LABEL[call.outcome] : null
  const name = call.callee.name ? call.callee.name.split(",")[0] : call.callee.handle
  return <article className={`call${live ? " call-running" : ""}`} id={call.id} aria-label={`${call.line === "site" ? "Site" : "Driver"} call to ${name}`}>
    <div className="call-head">
      <Icon name="phone" className={live ? "tone-accent" : "tone-neutral"} />
      <div>
        <div className="call-title">{call.line === "site" ? "Site call" : "Driver call"} to {name}</div>
        <div className="call-sub">{call.callee.handle}{call.callee.role ? ` · ${call.callee.role}` : ""} · started {demoTime(call.startedAt)}{call.attempt > 1 ? ` · attempt ${call.attempt}` : ""}</div>
      </div>
      <div className="call-pills">
        <Pill tone={live ? "accent" : "neutral"} dot={live}>Tier {call.tier}</Pill>
        {live ? <Pill tone="accent">{STATE_LABEL[call.state]}</Pill> : outcome && <Pill tone={outcome.tone}>{outcome.label}</Pill>}
        <Pill>{call.answerer === "live" ? "Live phone" : "Simulated person"}</Pill>
      </div>
    </div>
    <p className="call-reason">{call.reason}</p>
    {live && call.answerer === "live" && call.state === "ringing" && <p className="call-reason tone-accent">Ringing on the {PHONE_NAME[call.line]} page (Phone, {call.line === "site" ? "Site" : "Driver"} persona). It waits there while another live call is on that phone.</p>}
    {call.summary && <p className="call-summary">{call.summary}{call.callbackAt && call.outcome === "callback" ? ` Callback at ${demoTime(call.callbackAt)}.` : ""}</p>}
    {call.handover && <dl className="call-check call-handover" aria-label="Handover">
      <dt>Open question</dt><dd>{call.handover.question}</dd>
      <dt>Next step</dt><dd>{call.handover.nextStep}</dd>
    </dl>}
    <CostMeter call={call} />
    {live ? <Transcript call={call} /> : <More label={`Transcript (${call.transcript.length} lines)`}><Transcript call={call} /></More>}
  </article>
}

const PHONE_NAME: Record<CallLineView["line"], string> = { site: "Site phone", driver: "Driver phone" }

/** Lines the operator can ring live now: something left to ask, or a callback waiting (ticket 11). */
const ringable = (line: CallLineView) => !!line.callee && (line.status === "to_call" || line.status === "callback" || line.status === "callback_due" || line.status === "on_request")

/** "Ring live": starts the line's call now, ringing on the Site or Driver phone page instead of the simulated person. */
function RingLive({ orderId, line }: { orderId: string; line: CallLineView }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const ring = async () => {
    setState({ busy: true, error: null })
    const response = await fetch("/api/calls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ringLive", orderId, line: line.line }) })
    const data = await response.json().catch(() => null) as { error?: string } | null
    setState({ busy: false, error: response.ok ? null : data?.error ?? "The call did not start" })
    if (response.ok) window.dispatchEvent(new Event(CLOCK_EVENT))
  }
  const name = line.callee?.name ? line.callee.name.split(",")[0] : line.callee?.handle
  return <div className="call-ring-live">
    <button type="button" className="btn btn-tertiary btn-s" onClick={ring} disabled={state.busy}><Icon name="phone" />{state.busy ? "Ringing…" : `Ring ${name} live`}</button>
    <span>{line.status === "on_request" ? `${line.text} Rings ` : line.status === "callback" ? "Calls back now, " : ""}on the {PHONE_NAME[line.line]} page instead of the simulated person.</span>
    {state.error && <span className="call-ring-error" role="alert">{state.error}</span>}
  </div>
}

/** The order's calls and call lines; `compact` (queue preview) shows one line per line. */
export function CallsBlock({ orderId, calls = [], lines = [], blocked = [], compact = false }: { orderId?: string; calls?: Call[]; lines?: CallLineView[]; blocked?: BlockedCall[]; compact?: boolean }) {
  if (!calls.length && !blocked.length && !lines.some(ringable)) return null
  const waiting = lines.filter((line) => (line.status === "callback" || line.status === "callback_due") && line.text)
  if (compact) {
    return <div className="checks-block"><h3>Calls</h3><ul className="checks-list">
      {lines.filter((line) => line.latest || line.status !== "done").map((line) => <li className="check" key={line.line}>
        <Icon name="phone" className={line.status === "calling" ? "tone-accent" : "tone-neutral"} />
        <div><div className="check-title">{line.text || (line.latest?.summary ?? "")}</div>
          {line.latest && <div className="check-detail">Tier {line.latest.tier} · {eur(line.latest.cost.totalEur)} against {eur(line.latest.cost.operatorEur)} for an operator</div>}</div>
      </li>)}
    </ul></div>
  }
  const ordered = [...calls].reverse()
  return <div className="checks-block" id="calls">
    <h3>Calls</h3>
    {waiting.map((line) => <p className="call-waiting" key={line.line}><Icon name="waiting" className="tone-accent" />{line.text}</p>)}
    {orderId && lines.filter(ringable).map((line) => <RingLive key={`ring-${line.line}`} orderId={orderId} line={line} />)}
    {blocked.map((row, i) => <p className="call-waiting" key={`b${i}`}><Icon name="note" className="tone-neutral" />{row.text}</p>)}
    {ordered.slice(0, 1).map((call) => <CallCard key={call.id} call={call} />)}
    {ordered.length > 1 && <More label={`Earlier calls (${ordered.length - 1})`}>{ordered.slice(1).map((call) => <CallCard key={call.id} call={call} />)}</More>}
  </div>
}
